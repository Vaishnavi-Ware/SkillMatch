import os
import base64
import certifi
import random
import re
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory
from werkzeug.security import check_password_hash, generate_password_hash
from pymongo import MongoClient
from pymongo.errors import DuplicateKeyError, ServerSelectionTimeoutError
from bson import ObjectId
from bson.errors import InvalidId
from dotenv import load_dotenv
import google.genai as genai

# Load environment variables from .env file
load_dotenv()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOAD_DIR = os.path.join(BASE_DIR, 'static', 'uploads')
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# MongoDB Configuration
# ---------------------------------------------------------------------------
MONGO_URI     = os.environ.get('MONGO_URI', 'mongodb+srv://skillmatch_user:jaVj47EIZSwydtxz@skillmatch-cluster.9o8oz8y.mongodb.net/')
MONGO_DB_NAME = os.environ.get('MONGO_DB_NAME', 'skillmatch')
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')

_mongo_client = None
_mongo_db     = None
_mongo_error  = None


def get_db():
    global _mongo_client, _mongo_db, _mongo_error
    if _mongo_db is not None:
        return _mongo_db
    if _mongo_error is not None:
        return None
    try:
        use_tls = MONGO_URI.startswith('mongodb+srv://') or MONGO_URI.startswith('mongodb+tls://')
        client_kwargs = {
            'serverSelectionTimeoutMS': 5000,
            'connectTimeoutMS': 5000,
            'socketTimeoutMS': 20000,
        }
        if use_tls:
            client_kwargs['tls'] = True
            client_kwargs['tlsCAFile'] = certifi.where()
        _mongo_client = MongoClient(MONGO_URI, **client_kwargs)
        _mongo_client.admin.command('ping')
        _mongo_db = _mongo_client[MONGO_DB_NAME]
        return _mongo_db
    except Exception as e:
        _mongo_error = str(e)
        _mongo_client = None
        _mongo_db = None
        print(f'[SkillMatch] WARNING — MongoDB not reachable: {e}')
        return None


class DBUnavailable(Exception):
    pass


def require_db():
    db = get_db()
    if db is None:
        raise DBUnavailable('MongoDB not reachable. Start MongoDB or set MONGO_URI.')
    return db


def to_oid(val):
    try:
        return ObjectId(str(val))
    except (InvalidId, TypeError):
        return None


def validate_password(password):
    if len(password) < 8:
        return False, "Password must be at least 8 characters long"
    if not re.search(r'[A-Z]', password):
        return False, "Password must contain at least one uppercase letter"
    if not re.search(r'[a-z]', password):
        return False, "Password must contain at least one lowercase letter"
    if not re.search(r'[0-9]', password):
        return False, "Password must contain at least one number"
    if not re.search(r'[!@#$%^&*(),.?":{}|<>]', password):
        return False, "Password must contain at least one special symbol"
    return True, "Valid password"


def doc_to_dict(doc, exclude=None):
    if doc is None:
        return {}
    exclude = set(exclude or [])
    result = {}
    for key, value in doc.items():
        if key in exclude:
            continue
        if isinstance(value, ObjectId):
            if key == '_id':
                result['id'] = str(value)
            else:
                result[key] = str(value)
        elif isinstance(value, datetime):
            result[key] = value.isoformat()
        elif isinstance(value, dict):
            result[key] = doc_to_dict(value, exclude=None)
        elif isinstance(value, list):
            result[key] = [doc_to_dict(item, exclude=None) if isinstance(item, dict) else item for item in value]
        else:
            result[key] = value
    return result


app = Flask(__name__, static_folder='static', static_url_path='/static')
app.config['MAX_CONTENT_LENGTH'] = 5 * 1024 * 1024  # 5MB max upload


@app.errorhandler(DBUnavailable)
def handle_db_unavailable(error):
    return jsonify({'error': str(error)}), 503


# ---------------------------------------------------------------------------
# Authorization helpers
# ---------------------------------------------------------------------------
def verify_user_authorization(identifier, role):
    """Verify that user exists and return their ID and collection"""
    if not identifier or not role:
        return None, None, None, jsonify({'error': 'identifier and role are required'}), 400
    
    db = require_db()
    q = {'$or': [{'email': identifier}, {'phone': identifier}]}
    
    if role == 'worker':
        col = db.workers
    elif role == 'employer':
        col = db.employers
    elif role == 'admin':
        col = db.admins
    else:
        return None, None, None, jsonify({'error': 'Invalid role'}), 400
    
    user = col.find_one(q, {'_id': 1})
    if not user:
        return None, None, None, jsonify({'error': f'{role.capitalize()} not found'}), 404
    
    return user['_id'], col, db, None, None


def require_admin(identifier, role):
    """Verify user is admin"""
    if role != 'admin':
        return None, None, None, jsonify({'error': 'Admin access required. Only administrators can perform this action.'}), 403
    
    user_id, col, db, err, code = verify_user_authorization(identifier, role)
    if err:
        return None, None, None, err, code
    
    return user_id, col, db, None, None


def require_owner_authorization(identifier, role, resource_id, collection_name):
    """Verify user owns the resource or is admin"""
    user_id, col, db, err, code = verify_user_authorization(identifier, role)
    if err:
        return None, None, None, err, code
    
    resource_oid = to_oid(resource_id)
    if not resource_oid:
        return None, None, None, jsonify({'error': 'Invalid resource ID'}), 400
    
    # Admins can modify anything
    if role == 'admin':
        return user_id, db, resource_oid, None, None
    
    # Get resource
    resource = db[collection_name].find_one({'_id': resource_oid})
    if not resource:
        return None, None, None, jsonify({'error': 'Resource not found'}), 404
    
    # Check if user is the owner
    owner_id = resource.get('owner_id') if collection_name == 'posts' else resource.get('_id')
    if collection_name == 'posts':
        if resource.get('owner_id') != user_id:
            return None, None, None, jsonify({'error': 'You can only modify your own posts'}), 403
    else:
        if resource.get('_id') != user_id:
            return None, None, None, jsonify({'error': 'You can only modify your own profile'}), 403
    
    return user_id, db, resource_oid, None, None


# ---------------------------------------------------------------------------
# Static / seed data
# ---------------------------------------------------------------------------
nco_groups = [
    {"num":"1","name":"LEGISLATORS, SENIOR OFFICIALS AND MANAGERS","color":"#e85d26","subs":["Legislators and Senior Officials","Corporate Managers","General Managers"]},
    {"num":"2","name":"PROFESSIONALS","color":"#1d5fa6","subs":["Physical, Mathematical and Engineering Science Professionals","Life Science and Health Professionals","Teaching Professionals","Other Professionals"]},
    {"num":"3","name":"TECHNICIANS AND ASSOCIATE PROFESSIONALS","color":"#2d7d46","subs":["Physical and Engineering Science Associate Professionals","Life Science and Health Associate Professionals","Teaching Associate Professionals","Other Associate Professionals"]},
    {"num":"4","name":"CLERKS","color":"#d4860a","subs":["Office Clerks","Customer Services Clerks"]},
    {"num":"5","name":"SERVICE WORKERS AND SHOP & MARKET SALES WORKERS","color":"#7c3aed","subs":["Personal and Protective Service Workers","Models, Sales Persons and Demonstrators"]},
    {"num":"6","name":"SKILLED AGRICULTURAL AND FISHERY WORKERS","color":"#2d7d46","subs":["Market Oriented Skilled Agricultural and Fishery Workers","Subsistence Agricultural and Fishery Workers"]},
    {"num":"7","name":"CRAFT AND RELATED TRADES WORKERS","color":"#e85d26","subs":["Extraction and Building Trades Workers","Metal, Machinery and Related Trades Workers","Precision, Handicraft, Printing and Related Trades Workers","Other Craft and Related Trades Workers"]},
    {"num":"8","name":"PLANT AND MACHINE OPERATORS AND ASSEMBLERS","color":"#1d5fa6","subs":["Stationary Plant and Related Operators","Machine Operators and Assemblers","Drivers and Mobile-Plant Operators"]},
    {"num":"9","name":"ELEMENTARY OCCUPATIONS","color":"#d4860a","subs":["Sales and Services Elementary Occupations","Agricultural, Fishery and Related Labourers","Labourers in Mining, Construction, Manufacturing and Transport","House Maid / Domestic Helper","Nanny / Child Care Worker","Elder / Disabled Care Worker","Cook / Household Chef","Watchman / Chowkidar"]},
]

_SAMPLE_WORKERS = [
    {"first_name":"Sunita","last_name":"Devi","role":"Housemaid & Cook","category":"Domestic","city":"Mumbai","state":"Maharashtra","experience_years":5,"salary_expected":"₹12,000/mo","skills":"Cooking,Cleaning,Utensils,Washing","available":True,"verified":True,"phone":"9876500000","email":"sunita@example.com","security_question":"What is your mother's maiden name?","security_answer":"Saxena","icon":"👩"},
    {"first_name":"Ramesh","last_name":"Kumar","role":"Electrician","category":"Trades","city":"Pune","state":"Maharashtra","experience_years":8,"salary_expected":"₹22,000/mo","skills":"Wiring,Panel,AC Repair,Earthing","available":True,"verified":True,"phone":"9876500001","email":"ramesh@example.com","security_question":"What was your first school?","security_answer":"Vidyalaya","icon":"👨"},
    {"first_name":"Kamla","last_name":"Bai","role":"Nanny / Babysitter","category":"Domestic","city":"Delhi","state":"Delhi","experience_years":3,"salary_expected":"₹10,000/mo","skills":"Child Care,First Aid,Cooking,Homework Help","available":True,"verified":False,"phone":"9876500002","email":"kamla@example.com","security_question":"What is your pet's name?","security_answer":"Moti","icon":"👩"},
    {"first_name":"Gopal","last_name":"Singh","role":"Truck Driver","category":"Transport","city":"Ahmedabad","state":"Gujarat","experience_years":10,"salary_expected":"₹25,000/mo","skills":"HMV Licence,Night Driving,GPS,Loading","available":True,"verified":True,"phone":"9876500003","email":"gopal@example.com","security_question":"What is your mother's maiden name?","security_answer":"Patel","icon":"👨"},
    {"first_name":"Fatima","last_name":"Shaikh","role":"Caretaker (Elderly)","category":"Domestic","city":"Bengaluru","state":"Karnataka","experience_years":4,"salary_expected":"₹14,000/mo","skills":"Elder Care,Medicines,Mobility Help,Cooking","available":False,"verified":True,"phone":"9876500004","email":"fatima@example.com","security_question":"What was your first school?","security_answer":"St Mary","icon":"👩"},
]

_SAMPLE_JOBS = [
    {"title":"Full-Time Cook for Family of 5","employer":"Sharma Family","city":"Pune","salary":"₹15,000/mo","type":"Full-Time","category":"Domestic","description":"Experienced cook required for daily meals, light cleaning, and care of two children.","contact_number":"9876500100","contact_email":"sharma.family@example.com"},
    {"title":"Electrician for Housing Society","employer":"Greenview Society","city":"Mumbai","salary":"₹20,000/mo","type":"Contract","category":"Trades","description":"Experienced electrician needed for maintenance and repairs in a residential society.","contact_number":"9876500101","contact_email":"hr@greenviewsociety.com"},
    {"title":"Live-In Nanny for Infant","employer":"Mehta Family","city":"Bengaluru","salary":"₹18,000/mo","type":"Live-In","category":"Domestic","description":"Seeking a patient live-in nanny for infant care, feeding, and supervision.","contact_number":"9876500102","contact_email":"mehta.family@example.com"},
    {"title":"Long-Haul Truck Driver","employer":"ShipFast Logistics","city":"Delhi","salary":"₹28,000/mo","type":"Full-Time","category":"Transport","description":"Experienced truck driver for long-haul routes with HMV license.","contact_number":"9876500103","contact_email":"recruitment@shipfastlogistics.com"},
]

_SAMPLE_ADMIN = {"name":"Administrator","email":"admin@skillmatch.in","phone":"9876500999","password":"Admin123!"}

# ---------------------------------------------------------------------------
# Email sending disabled
# Applications and offers are stored in the database only.
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# DB bootstrap
# ---------------------------------------------------------------------------
def ensure_db():
    db = get_db()
    if db is None:
        return
    db.workers.create_index([('email', 1)])
    db.workers.create_index([('phone', 1)])
    db.employers.create_index([('email', 1)])
    db.employers.create_index([('phone', 1)])
    try:
        db.admins.create_index([('email', 1)], unique=True, sparse=True)
        db.admins.create_index([('phone', 1)], unique=True, sparse=True)
    except Exception:
        pass

    if db.admins.count_documents({}) == 0:
        db.admins.insert_one({**{k: _SAMPLE_ADMIN[k] for k in ('name','email','phone')},
            'password_hash': generate_password_hash(_SAMPLE_ADMIN['password']),
            'created_at': datetime.utcnow().isoformat()})

    if db.workers.count_documents({}) == 0:
        for w in _SAMPLE_WORKERS:
            db.workers.insert_one({**w, 'password_hash': generate_password_hash('Password123!'),
                'created_at': datetime.utcnow().isoformat(), 'photo_url': None})

    if db.jobs.count_documents({}) == 0:
        for j in _SAMPLE_JOBS:
            db.jobs.insert_one({**j, 'employer_id': None, 'posted_at': datetime.utcnow().isoformat()})


try:
    db = get_db()
    if db is not None:
        ensure_db()
        print('[SkillMatch] MongoDB ready.')
    else:
        print('[SkillMatch] WARNING — MongoDB not reachable. Running in demo mode with sample data.')
except Exception as e:
    print(f'[SkillMatch] WARNING — MongoDB not reachable: {e}')


# ---------------------------------------------------------------------------
# Routes — Static
# ---------------------------------------------------------------------------
@app.route('/')
def index():
    return send_from_directory(BASE_DIR, 'skillmatch.html')


@app.route('/static/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOAD_DIR, filename)


# ---------------------------------------------------------------------------
# Profile Photo Upload
# ---------------------------------------------------------------------------
@app.route('/api/upload-photo', methods=['POST'])
def api_upload_photo():
    p     = request.get_json() or {}
    ident = p.get('identifier')
    role  = p.get('role')
    photo = p.get('photo')  # base64 data URL

    if not ident or not role or not photo:
        return jsonify({'error': 'identifier, role, and photo are required'}), 400

    # Parse base64 data URL
    try:
        if ',' in photo:
            header, data = photo.split(',', 1)
            ext = 'jpg'
            if 'png' in header:
                ext = 'png'
            elif 'gif' in header:
                ext = 'gif'
            elif 'webp' in header:
                ext = 'webp'
        else:
            data = photo
            ext  = 'jpg'
        img_bytes = base64.b64decode(data)
        if len(img_bytes) > 4 * 1024 * 1024:
            return jsonify({'error': 'Photo must be under 4MB'}), 400
    except Exception as e:
        return jsonify({'error': f'Invalid image data: {e}'}), 400

    db = require_db()
    q  = {'$or': [{'email': ident}, {'phone': ident}]}

    if role == 'worker':
        doc = db.workers.find_one(q)
    elif role == 'employer':
        doc = db.employers.find_one(q)
    else:
        return jsonify({'error': 'Invalid role'}), 400

    if not doc:
        return jsonify({'error': 'User not found'}), 404

    uid      = str(doc['_id'])
    filename = f"{role}_{uid}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    with open(filepath, 'wb') as f:
        f.write(img_bytes)

    photo_url = f'/static/uploads/{filename}'

    if role == 'worker':
        db.workers.update_one({'_id': doc['_id']}, {'$set': {'photo_url': photo_url}})
    else:
        db.employers.update_one({'_id': doc['_id']}, {'$set': {'photo_url': photo_url}})

    return jsonify({'success': True, 'photo_url': photo_url})


# ---------------------------------------------------------------------------
# Public Profile (worker or employer) — for viewing from Find Worker/Job pages
# ---------------------------------------------------------------------------
@app.route('/api/public-profile', methods=['POST'])
def api_public_profile():
    p    = request.get_json() or {}
    uid  = p.get('id')
    role = p.get('role', 'worker')
    if not uid:
        return jsonify({'error': 'id required'}), 400
    db  = require_db()
    oid = to_oid(uid)
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400

    if role == 'employer':
        doc = db.employers.find_one({'_id': oid}, {'password_hash': 0})
        if not doc:
            return jsonify({'error': 'Employer not found'}), 404
        d = doc_to_dict(doc)
        d['role'] = 'employer'
        # Get their posts
        posts = list(db.posts.find({'owner_id': oid, 'owner_role': 'employer'}).sort('created_at', -1))
        d['posts'] = [doc_to_dict(pp, exclude=['owner_id']) for pp in posts]
        # Get their jobs
        jobs = list(db.jobs.find({'employer_id': oid}))
        d['jobs'] = [doc_to_dict(jj) for jj in jobs]
        return jsonify(d)
    else:
        doc = db.workers.find_one({'_id': oid}, {'password_hash': 0, 'security_answer': 0})
        if not doc:
            return jsonify({'error': 'Worker not found'}), 404
        d = doc_to_dict(doc)
        d['role'] = 'worker'
        d['name'] = f"{d.pop('first_name', '')} {d.pop('last_name', '')}".strip()
        d['skills'] = d['skills'].split(',') if isinstance(d.get('skills'), str) else (d.get('skills') or [])
        # Get their posts
        posts = list(db.posts.find({'owner_id': oid, 'owner_role': 'worker'}).sort('created_at', -1))
        d['posts'] = [doc_to_dict(pp, exclude=['owner_id']) for pp in posts]
        return jsonify(d)


# ---------------------------------------------------------------------------
# Workers / Jobs / Employers (public listing)
# ---------------------------------------------------------------------------
@app.route('/api/workers')
def api_workers():
    db = get_db()
    q  = {}
    if cat := request.args.get('category', '').strip():
        q['category'] = cat
    if city := request.args.get('city', '').strip():
        q['city'] = city
    if s := request.args.get('search', '').strip():
        q['$or'] = [{'first_name':{'$regex':s,'$options':'i'}},
                    {'last_name': {'$regex':s,'$options':'i'}},
                    {'role':      {'$regex':s,'$options':'i'}},
                    {'skills':    {'$regex':s,'$options':'i'}}]
    if db is None:
        docs = _SAMPLE_WORKERS
        if cat: docs = [d for d in docs if d.get('category') == cat]
        if city: docs = [d for d in docs if d.get('city') == city]
        if s:
            term = s.lower()
            docs = [d for d in docs if term in d.get('first_name','').lower() or term in d.get('last_name','').lower() or term in d.get('role','').lower() or term in d.get('skills','').lower()]
        data = []
        for idx, doc in enumerate(docs, start=1):
            d = dict(doc)
            d['id'] = str(idx)
            d['name'] = f"{d.pop('first_name','')} {d.pop('last_name','')}".strip()
            d['skills'] = d['skills'].split(',') if d.get('skills') else []
            data.append(d)
        return jsonify(data)
    docs = list(db.workers.find(q, {'password_hash': 0, 'security_answer': 0}))
    data = []
    for doc in docs:
        d = doc_to_dict(doc)
        d['name']   = f"{d.pop('first_name','')} {d.pop('last_name','')}".strip()
        d['skills'] = d['skills'].split(',') if isinstance(d.get('skills'), str) else (d.get('skills') or [])
        data.append(d)
    return jsonify(data)


@app.route('/api/jobs')
def api_jobs():
    db = get_db()
    q  = {}
    if cat := request.args.get('category', '').strip():
        q['type'] = cat
    if s := request.args.get('search', '').strip():
        q['$or'] = [{'title':{'$regex':s,'$options':'i'}},{'city':{'$regex':s,'$options':'i'}},
                    {'employer':{'$regex':s,'$options':'i'}},{'category':{'$regex':s,'$options':'i'}}]
    if db is None:
        docs = _SAMPLE_JOBS
        if cat: docs = [d for d in docs if d.get('type') == cat]
        if s:
            term = s.lower()
            docs = [d for d in docs if term in d.get('title','').lower() or term in d.get('city','').lower() or term in d.get('employer','').lower() or term in d.get('category','').lower()]
        data = []
        for idx, doc in enumerate(docs, start=1):
            d = dict(doc); d['id'] = str(idx); data.append(d)
        return jsonify(data)
    return jsonify([doc_to_dict(d) for d in db.jobs.find(q)])


@app.route('/api/employers')
def api_employers():
    db = get_db()
    if db is None:
        return jsonify([])
    return jsonify([doc_to_dict(d) for d in db.employers.find({}, {'password_hash': 0})])


# ---------------------------------------------------------------------------
# Admin Routes
# ---------------------------------------------------------------------------
@app.route('/api/admin/workers')
def api_admin_workers():
    db   = require_db()
    docs = list(db.workers.find({}, {'password_hash': 0, 'security_answer': 0}))
    data = []
    for doc in docs:
        d = doc_to_dict(doc)
        d['name']   = f"{d.pop('first_name','')} {d.pop('last_name','')}".strip()
        d['skills'] = d['skills'].split(',') if isinstance(d.get('skills'), str) else (d.get('skills') or [])
        data.append(d)
    return jsonify(data)


@app.route('/api/admin/employers')
def api_admin_employers():
    db = require_db()
    return jsonify([doc_to_dict(d) for d in db.employers.find({}, {'password_hash': 0})])


@app.route('/api/admin/jobs')
def api_admin_jobs():
    db = require_db()
    return jsonify([doc_to_dict(d) for d in db.jobs.find({})])


@app.route('/api/admin/edit-worker', methods=['POST'])
def api_admin_edit_worker():
    p = request.get_json() or {}
    if not p.get('id'):
        return jsonify({'error': 'id required'}), 400
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    db  = require_db()
    upd = {}
    for f in ['first_name','last_name','role','category','city','state','phone','email','salary_expected']:
        if f in p:
            upd[f] = p[f]
    if 'skills' in p:
        upd['skills'] = p['skills']
    if 'experience_years' in p:
        upd['experience_years'] = int(p.get('experience_years') or 0)
    if 'verified' in p:
        upd['verified'] = bool(p['verified'])
    if 'available' in p:
        upd['available'] = bool(p['available'])
    db.workers.update_one({'_id': oid}, {'$set': upd})
    return jsonify({'success': True})


@app.route('/api/admin/edit-employer', methods=['POST'])
def api_admin_edit_employer():
    p = request.get_json() or {}
    if not p.get('id'):
        return jsonify({'error': 'id required'}), 400
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    db  = require_db()
    upd = {}
    for f in ['contact_name','company_name','employer_type','city','state','phone','email','description']:
        if f in p:
            upd[f] = p[f]
    if 'workers_needed' in p:
        upd['workers_needed'] = int(p.get('workers_needed') or 0)
    db.employers.update_one({'_id': oid}, {'$set': upd})
    return jsonify({'success': True})


@app.route('/api/admin/edit-job', methods=['POST'])
def api_admin_edit_job():
    p = request.get_json() or {}
    if not p.get('id'):
        return jsonify({'error': 'id required'}), 400
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    db  = require_db()
    upd = {}
    for f in ['title','employer','city','salary','type','category','contact_number','contact_email','description']:
        if f in p:
            upd[f] = p[f]
    db.jobs.update_one({'_id': oid}, {'$set': upd})
    return jsonify({'success': True})


@app.route('/api/admin/delete-worker', methods=['POST'])
def api_admin_delete_worker():
    p = request.get_json() or {}
    if not p.get('id'):
        return jsonify({'error': 'Worker id required'}), 400
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    db = require_db()
    db.workers.delete_one({'_id': oid})
    return jsonify({'success': True})


@app.route('/api/admin/delete-worker-cascade', methods=['POST'])
def api_admin_delete_worker_cascade():
    p = request.get_json() or {}
    if not p.get('id'):
        return jsonify({'error': 'Worker id required'}), 400
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    db = require_db()
    db.applications.delete_many({'worker_id': oid})
    db.worker_offers.delete_many({'worker_id': oid})
    db.posts.delete_many({'owner_id': oid, 'owner_role': 'worker'})
    db.workers.delete_one({'_id': oid})
    return jsonify({'success': True})


@app.route('/api/admin/delete-employer', methods=['POST'])
def api_admin_delete_employer():
    p = request.get_json() or {}
    if not p.get('id'):
        return jsonify({'error': 'Employer id required'}), 400
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    db = require_db()
    db.employers.delete_one({'_id': oid})
    return jsonify({'success': True})


@app.route('/api/admin/delete-employer-cascade', methods=['POST'])
def api_admin_delete_employer_cascade():
    p = request.get_json() or {}
    if not p.get('id'):
        return jsonify({'error': 'Employer id required'}), 400
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    db   = require_db()
    jobs = list(db.jobs.find({'employer_id': oid}, {'_id': 1}))
    j_ids = [j['_id'] for j in jobs]
    if j_ids:
        db.applications.delete_many({'job_id': {'$in': j_ids}})
    db.jobs.delete_many({'employer_id': oid})
    db.worker_offers.delete_many({'employer_id': oid})
    db.posts.delete_many({'owner_id': oid, 'owner_role': 'employer'})
    db.employers.delete_one({'_id': oid})
    return jsonify({'success': True})


@app.route('/api/admin/delete-job', methods=['POST'])
def api_admin_delete_job():
    p = request.get_json() or {}
    if not p.get('id'):
        return jsonify({'error': 'Job id required'}), 400
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    db = require_db()
    db.applications.delete_many({'job_id': oid})
    db.jobs.delete_one({'_id': oid})
    return jsonify({'success': True})


@app.route('/api/admin/posts')
def api_admin_posts():
    db = require_db()
    posts = list(db.posts.find().sort('created_at', -1))
    data = []
    for p in posts:
        d = doc_to_dict(p)
        # Add owner_identifier
        if d.get('owner_role') == 'worker':
            owner = db.workers.find_one({'_id': ObjectId(d['owner_id'])}, {'email': 1, 'phone': 1})
        elif d.get('owner_role') == 'employer':
            owner = db.employers.find_one({'_id': ObjectId(d['owner_id'])}, {'email': 1, 'phone': 1})
        else:
            owner = None
        if owner:
            d['owner_identifier'] = owner.get('email') or owner.get('phone')
        data.append(d)
    return jsonify(data)


@app.route('/api/admin/delete-post', methods=['POST'])
def api_admin_delete_post():
    p = request.get_json() or {}
    if not p.get('id'):
        return jsonify({'error': 'Post id required'}), 400
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    db = require_db()
    post = db.posts.find_one({'_id': oid}) if oid else None
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    db.likes.delete_many({'post_id': oid})
    db.comments.delete_many({'post_id': oid})
    db.shares.delete_many({'post_id': oid})
    db.posts.delete_one({'_id': oid})
    return jsonify({'success': True})


# ---------------------------------------------------------------------------
# USER PROFILE MANAGEMENT (Users can edit only their own profiles)
# ---------------------------------------------------------------------------
@app.route('/api/worker/profile', methods=['PUT'])
def api_update_worker_profile():
    """Allow worker to update their own profile only"""
    p = request.get_json() or {}
    identifier = p.get('identifier')
    role = p.get('role')
    
    if role != 'worker':
        return jsonify({'error': 'Only workers can use this endpoint'}), 403
    
    user_id, col, db, err, code = verify_user_authorization(identifier, role)
    if err:
        return err, code
    
    upd = {}
    for f in ['first_name','last_name','role','category','city','state','phone','email','salary_expected']:
        if f in p:
            upd[f] = p[f]
    if 'skills' in p:
        upd['skills'] = p['skills']
    if 'experience_years' in p:
        upd['experience_years'] = int(p.get('experience_years') or 0)
    if 'available' in p:
        upd['available'] = bool(p['available'])
    
    if not upd:
        return jsonify({'error': 'No fields to update'}), 400
    
    db.workers.update_one({'_id': user_id}, {'$set': upd})
    return jsonify({'success': True, 'message': '✅ Your profile has been updated successfully'})


@app.route('/api/employer/profile', methods=['PUT'])
def api_update_employer_profile():
    """Allow employer to update their own profile only"""
    p = request.get_json() or {}
    identifier = p.get('identifier')
    role = p.get('role')
    
    if role not in ('employer', 'family/home'):
        return jsonify({'error': 'Only employers can use this endpoint'}), 403
    
    user_id, col, db, err, code = verify_user_authorization(identifier, 'employer')
    if err:
        return err, code
    
    upd = {}
    for f in ['contact_name','company_name','employer_type','city','state','phone','email','description']:
        if f in p:
            upd[f] = p[f]
    if 'workers_needed' in p:
        upd['workers_needed'] = int(p.get('workers_needed') or 0)
    
    if not upd:
        return jsonify({'error': 'No fields to update'}), 400
    
    db.employers.update_one({'_id': user_id}, {'$set': upd})
    return jsonify({'success': True, 'message': '✅ Your profile has been updated successfully'})


@app.route('/api/worker/profile', methods=['DELETE'])
def api_delete_worker_account():
    """Allow worker to delete their own account"""
    p = request.get_json() or {}
    identifier = p.get('identifier')
    role = p.get('role')
    
    if role != 'worker':
        return jsonify({'error': 'Only workers can delete worker accounts'}), 403
    
    user_id, col, db, err, code = verify_user_authorization(identifier, role)
    if err:
        return err, code
    
    # Cascade delete: Remove associated data
    db.applications.delete_many({'worker_id': user_id})
    db.worker_offers.delete_many({'worker_id': user_id})
    db.posts.delete_many({'owner_id': user_id, 'owner_role': 'worker'})
    db.workers.delete_one({'_id': user_id})
    
    return jsonify({'success': True, 'message': '✅ Your account has been deleted'})


@app.route('/api/employer/profile', methods=['DELETE'])
def api_delete_employer_account():
    """Allow employer to delete their own account"""
    p = request.get_json() or {}
    identifier = p.get('identifier')
    role = p.get('role')
    
    if role not in ('employer', 'family/home'):
        return jsonify({'error': 'Only employers can delete employer accounts'}), 403
    
    user_id, col, db, err, code = verify_user_authorization(identifier, 'employer')
    if err:
        return err, code
    
    # Cascade delete: Remove associated data
    jobs = list(db.jobs.find({'employer_id': user_id}, {'_id': 1}))
    job_ids = [j['_id'] for j in jobs]
    if job_ids:
        db.applications.delete_many({'job_id': {'$in': job_ids}})
    db.jobs.delete_many({'employer_id': user_id})
    db.worker_offers.delete_many({'employer_id': user_id})
    db.posts.delete_many({'owner_id': user_id, 'owner_role': 'employer'})
    db.employers.delete_one({'_id': user_id})
    
    return jsonify({'success': True, 'message': '✅ Your account has been deleted'})


# ---------------------------------------------------------------------------
# ADMIN-ONLY ENDPOINTS (Securing with authorization checks)
# ---------------------------------------------------------------------------
@app.route('/api/admin/edit-worker-auth', methods=['POST'])
def api_admin_edit_worker_auth():
    """Admin-only: Edit any worker"""
    p = request.get_json() or {}
    identifier = p.get('admin_identifier')
    role = p.get('admin_role')
    
    admin_id, col, db, err, code = require_admin(identifier, role)
    if err:
        return err, code
    
    if not p.get('id'):
        return jsonify({'error': 'Worker id required'}), 400
    
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    
    upd = {}
    for f in ['first_name','last_name','role','category','city','state','phone','email','salary_expected']:
        if f in p:
            upd[f] = p[f]
    if 'skills' in p:
        upd['skills'] = p['skills']
    if 'experience_years' in p:
        upd['experience_years'] = int(p.get('experience_years') or 0)
    if 'verified' in p:
        upd['verified'] = bool(p['verified'])
    if 'available' in p:
        upd['available'] = bool(p['available'])
    
    db.workers.update_one({'_id': oid}, {'$set': upd})
    return jsonify({'success': True})


@app.route('/api/admin/edit-employer-auth', methods=['POST'])
def api_admin_edit_employer_auth():
    """Admin-only: Edit any employer"""
    p = request.get_json() or {}
    identifier = p.get('admin_identifier')
    role = p.get('admin_role')
    
    admin_id, col, db, err, code = require_admin(identifier, role)
    if err:
        return err, code
    
    if not p.get('id'):
        return jsonify({'error': 'Employer id required'}), 400
    
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    
    upd = {}
    for f in ['contact_name','company_name','employer_type','city','state','phone','email','description']:
        if f in p:
            upd[f] = p[f]
    if 'workers_needed' in p:
        upd['workers_needed'] = int(p.get('workers_needed') or 0)
    
    db.employers.update_one({'_id': oid}, {'$set': upd})
    return jsonify({'success': True})


@app.route('/api/admin/delete-worker-auth', methods=['POST'])
def api_admin_delete_worker_auth():
    """Admin-only: Delete worker"""
    p = request.get_json() or {}
    identifier = p.get('admin_identifier')
    role = p.get('admin_role')
    
    admin_id, col, db, err, code = require_admin(identifier, role)
    if err:
        return err, code
    
    if not p.get('id'):
        return jsonify({'error': 'Worker id required'}), 400
    
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    
    # Cascade delete
    db.applications.delete_many({'worker_id': oid})
    db.worker_offers.delete_many({'worker_id': oid})
    db.posts.delete_many({'owner_id': oid, 'owner_role': 'worker'})
    db.workers.delete_one({'_id': oid})
    
    return jsonify({'success': True, 'message': '✅ Worker deleted by admin'})


@app.route('/api/admin/delete-employer-auth', methods=['POST'])
def api_admin_delete_employer_auth():
    """Admin-only: Delete employer"""
    p = request.get_json() or {}
    identifier = p.get('admin_identifier')
    role = p.get('admin_role')
    
    admin_id, col, db, err, code = require_admin(identifier, role)
    if err:
        return err, code
    
    if not p.get('id'):
        return jsonify({'error': 'Employer id required'}), 400
    
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    
    # Cascade delete
    jobs = list(db.jobs.find({'employer_id': oid}, {'_id': 1}))
    job_ids = [j['_id'] for j in jobs]
    if job_ids:
        db.applications.delete_many({'job_id': {'$in': job_ids}})
    db.jobs.delete_many({'employer_id': oid})
    db.worker_offers.delete_many({'employer_id': oid})
    db.posts.delete_many({'owner_id': oid, 'owner_role': 'employer'})
    db.employers.delete_one({'_id': oid})
    
    return jsonify({'success': True, 'message': '✅ Employer deleted by admin'})


@app.route('/api/admin/delete-job-auth', methods=['POST'])
def api_admin_delete_job_auth():
    """Admin-only: Delete job listing"""
    p = request.get_json() or {}
    identifier = p.get('admin_identifier')
    role = p.get('admin_role')
    
    admin_id, col, db, err, code = require_admin(identifier, role)
    if err:
        return err, code
    
    if not p.get('id'):
        return jsonify({'error': 'Job id required'}), 400
    
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    
    db.applications.delete_many({'job_id': oid})
    db.jobs.delete_one({'_id': oid})
    
    return jsonify({'success': True, 'message': '✅ Job deleted by admin'})


@app.route('/api/admin/delete-post-auth', methods=['POST'])
def api_admin_delete_post_auth():
    """Admin-only: Delete any post"""
    p = request.get_json() or {}
    identifier = p.get('admin_identifier')
    role = p.get('admin_role')
    
    admin_id, col, db, err, code = require_admin(identifier, role)
    if err:
        return err, code
    
    if not p.get('id'):
        return jsonify({'error': 'Post id required'}), 400
    
    oid = to_oid(p['id'])
    if not oid:
        return jsonify({'error': 'Invalid id'}), 400
    
    post = db.posts.find_one({'_id': oid})
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    # Clean up associated data
    db.likes.delete_many({'post_id': oid})
    db.comments.delete_many({'post_id': oid})
    db.shares.delete_many({'post_id': oid})
    db.posts.delete_one({'_id': oid})
    
    return jsonify({'success': True, 'message': '✅ Post deleted by admin'})


@app.route('/api/nco')
def api_nco():
    return jsonify(nco_groups)


# ---------------------------------------------------------------------------
# Register / Login / Profile
# ---------------------------------------------------------------------------
@app.route('/api/register', methods=['POST'])
def api_register():
    p    = request.get_json() or {}
    utyp = p.get('type')
    db   = require_db()
    now  = datetime.utcnow().isoformat()

    # Validate password for new registrations
    password = p.get('password')
    if not password:
        return jsonify({'error': 'Password is required'}), 400
    valid, msg = validate_password(password)
    if not valid:
        return jsonify({'error': msg}), 400

    if utyp == 'worker':
        if not all(p.get(f) for f in ['first_name','last_name','role','category','city','password']):
            return jsonify({'error': 'Missing required worker fields'}), 400
        db.workers.insert_one({
            'first_name': p['first_name'], 'last_name': p['last_name'],
            'role': p['role'], 'category': p['category'], 'city': p['city'],
            'state': p.get('state'), 'experience_years': int(p.get('experience_years') or 0),
            'salary_expected': p.get('salary_expected'), 'skills': p.get('skills',''),
            'available': True, 'verified': False,
            'phone': p.get('phone'), 'email': p.get('email'),
            'password_hash': generate_password_hash(p['password']),
            'security_question': p.get('security_question'),
            'security_answer': p.get('security_answer'),
            'icon': p.get('icon','👤'), 'photo_url': None, 'created_at': now,
        })
        return jsonify({'success': True, 'message': 'Worker account created'})

    if utyp == 'employer':
        if not all(p.get(f) for f in ['contact_name','company_name','password']):
            return jsonify({'error': 'Missing required employer fields'}), 400
        db.employers.insert_one({
            'contact_name': p['contact_name'], 'company_name': p['company_name'],
            'employer_type': p.get('employer_type'),
            'phone': p.get('phone'), 'email': p.get('email'),
            'city': p.get('city'), 'state': p.get('state'),
            'workers_needed': int(p.get('workers_needed') or 0),
            'description': p.get('description'),
            'password_hash': generate_password_hash(p['password']),
            'photo_url': None, 'created_at': now,
        })
        return jsonify({'success': True, 'message': 'Employer account created'})

    if utyp == 'admin':
        if not all(p.get(f) for f in ['name','password']):
            return jsonify({'error': 'Missing required admin fields'}), 400
        try:
            db.admins.insert_one({
                'name': p['name'], 'email': p.get('email'), 'phone': p.get('phone'),
                'password_hash': generate_password_hash(p['password']), 'created_at': now,
            })
        except DuplicateKeyError:
            return jsonify({'error': 'Admin email or phone already exists'}), 400
        return jsonify({'success': True, 'message': 'Administrator account created'})

    return jsonify({'error': 'Invalid registration type'}), 400


@app.route('/api/login', methods=['POST'])
def api_login():
    p     = request.get_json() or {}
    role  = p.get('role', 'worker')
    ident = p.get('identifier')
    pw    = p.get('password', '')
    db    = require_db()
    q     = {'$or': [{'email': ident}, {'phone': ident}]}
    if role == 'admin':
        row = db.admins.find_one(q)
        if row and check_password_hash(row['password_hash'], pw):
            return jsonify({'success': True, 'role': 'admin'})
        return jsonify({'success': False, 'message': 'Invalid admin credentials'}), 401
    if role in ('employer', 'family/home'):
        row = db.employers.find_one(q)
        if row and check_password_hash(row['password_hash'], pw):
            return jsonify({'success': True, 'role': 'employer'})
        return jsonify({'success': False, 'message': 'Invalid employer credentials'}), 401
    row = db.workers.find_one(q)
    if row and check_password_hash(row['password_hash'], pw):
        return jsonify({'success': True, 'role': 'worker'})
    return jsonify({'success': False, 'message': 'Invalid worker credentials'}), 401


@app.route('/api/profile', methods=['POST'])
def api_profile():
    p     = request.get_json() or {}
    role  = p.get('role')
    ident = p.get('identifier')
    if not role or not ident:
        return jsonify({'error': 'Role and identifier are required'}), 400
    db = require_db()
    q  = {'$or': [{'email': ident}, {'phone': ident}]}
    if role == 'admin':
        row = db.admins.find_one(q, {'password_hash': 0})
        if not row:
            return jsonify({'error': 'Admin not found'}), 404
        d = doc_to_dict(row); d['role'] = 'admin'
        return jsonify(d)
    if role == 'employer':
        row = db.employers.find_one(q, {'password_hash': 0})
        if not row:
            return jsonify({'error': 'Employer not found'}), 404
        d = doc_to_dict(row); d['name'] = d.get('contact_name'); d['role'] = 'employer'
        return jsonify(d)
    row = db.workers.find_one(q, {'password_hash': 0, 'security_answer': 0})
    if not row:
        return jsonify({'error': 'Worker not found'}), 404
    d = doc_to_dict(row)
    d['role']   = 'worker'
    d['name']   = f"{d.pop('first_name','')} {d.pop('last_name','')}".strip()
    d['skills'] = d['skills'].split(',') if isinstance(d.get('skills'), str) else (d.get('skills') or [])
    return jsonify(d)


@app.route('/api/profile/update', methods=['POST'])
def api_profile_update():
    p = request.get_json() or {}
    ident = p.get('identifier')
    role = p.get('role')
    if not ident or not role:
        return jsonify({'error': 'identifier and role are required'}), 400
    db = require_db()
    q = {'$or': [{'email': ident}, {'phone': ident}]}
    if role == 'worker':
        col = db.workers
        update_data = {}
        for field in ['first_name', 'last_name', 'role', 'city', 'state', 'experience_years', 'salary_expected', 'email', 'phone', 'available']:
            if field in p:
                update_data[field] = p[field]
        if 'skills' in p:
            update_data['skills'] = ','.join(p['skills']) if isinstance(p['skills'], list) else p['skills']
        col.update_one(q, {'$set': update_data})
    elif role == 'employer':
        col = db.employers
        update_data = {}
        for field in ['company_name', 'contact_name', 'employer_type', 'city', 'state', 'workers_needed', 'email', 'phone', 'description']:
            if field in p:
                update_data[field] = p[field]
        col.update_one(q, {'$set': update_data})
    else:
        return jsonify({'error': 'Invalid role'}), 400
    return jsonify({'success': True, 'message': 'Profile updated successfully.'})


# ---------------------------------------------------------------------------
# Posts / Achievements
# ---------------------------------------------------------------------------
@app.route('/api/posts', methods=['POST'])
def api_create_post():
    p       = request.get_json() or {}
    ident   = p.get('identifier')
    role    = p.get('role')
    content = p.get('content', '').strip()
    if not ident or not role or not content:
        return jsonify({'error': 'identifier, role, and content are required'}), 400
    db  = require_db()
    q   = {'$or': [{'email': ident}, {'phone': ident}]}
    col = db.workers if role == 'worker' else db.employers
    doc = col.find_one(q, {'_id': 1})
    if not doc:
        return jsonify({'error': 'User not found'}), 404
    now = datetime.utcnow().isoformat()
    result = db.posts.insert_one({
        'owner_id': doc['_id'], 'owner_role': role,
        'post_type': p.get('post_type', 'achievement'),
        'title': p.get('title', '').strip(),
        'content': content, 'created_at': now, 'updated_at': now,
    })
    return jsonify({'success': True, 'post_id': str(result.inserted_id)})


@app.route('/api/posts/my', methods=['POST'])
def api_my_posts():
    p     = request.get_json() or {}
    ident = p.get('identifier')
    role  = p.get('role')
    if not ident or not role:
        return jsonify({'error': 'identifier and role are required'}), 400
    db  = require_db()
    q   = {'$or': [{'email': ident}, {'phone': ident}]}
    col = db.workers if role == 'worker' else db.employers
    doc = col.find_one(q, {'_id': 1})
    if not doc:
        return jsonify({'error': 'User not found'}), 404
    posts = list(db.posts.find({'owner_id': doc['_id'], 'owner_role': role}).sort('created_at', -1))
    return jsonify([doc_to_dict(pp) for pp in posts])


@app.route('/api/posts/all', methods=['GET'])
def api_all_posts():
    db = require_db()
    posts = list(db.posts.find().sort('created_at', -1))
    
    # Fetch user details for each post
    worker_ids = set()
    employer_ids = set()
    
    for post in posts:
        if post['owner_role'] == 'worker':
            worker_ids.add(post['owner_id'])
        else:
            employer_ids.add(post['owner_id'])
    
    workers_map = {}
    employers_map = {}
    
    if worker_ids:
        workers = list(db.workers.find({'_id': {'$in': list(worker_ids)}}, {'password_hash': 0, 'security_answer': 0}))
        workers_map = {w['_id']: w for w in workers}
    
    if employer_ids:
        employers = list(db.employers.find({'_id': {'$in': list(employer_ids)}}, {'password_hash': 0}))
        employers_map = {e['_id']: e for e in employers}
    
    # Build response with user details
    data = []
    for post in posts:
        post_dict = doc_to_dict(post)
        
        if post['owner_role'] == 'worker':
            user = workers_map.get(post['owner_id'], {})
            post_dict['owner_name'] = f"{user.get('first_name', '')} {user.get('last_name', '')}".strip() or 'Worker'
            post_dict['owner_icon'] = user.get('icon', '👷')
            post_dict['owner_photo'] = user.get('photo_url')
            post_dict['owner_identifier'] = user.get('email') or user.get('phone')
        else:
            user = employers_map.get(post['owner_id'], {})
            post_dict['owner_name'] = user.get('company_name') or user.get('contact_name') or 'Employer'
            post_dict['owner_icon'] = '🏢'
            post_dict['owner_photo'] = user.get('photo_url')
            post_dict['owner_identifier'] = user.get('email') or user.get('phone')
        
        # Add interaction counts
        post_id = post['_id']
        post_dict['like_count'] = db.likes.count_documents({'post_id': post_id})
        post_dict['comment_count'] = db.comments.count_documents({'post_id': post_id})
        post_dict['share_count'] = db.shares.count_documents({'post_id': post_id})
        
        # Check if current user liked this post (if authenticated)
        post_dict['user_liked'] = False
        ident = request.args.get('identifier')
        role = request.args.get('role')
        
        if ident and role:
            q = {'$or': [{'email': ident}, {'phone': ident}]}
            col = db.workers if role == 'worker' else db.employers
            current_user = col.find_one(q, {'_id': 1})
            if current_user:
                existing_like = db.likes.find_one({
                    'post_id': post_id,
                    'user_id': current_user['_id'],
                    'user_role': role
                })
                post_dict['user_liked'] = existing_like is not None
        
        data.append(post_dict)
    
    return jsonify(data)


@app.route('/api/posts/<post_id>', methods=['PUT'])
def api_update_post(post_id):
    p       = request.get_json() or {}
    ident   = p.get('identifier')
    role    = p.get('role')
    content = p.get('content', '').strip()
    if not ident or not role or not content:
        return jsonify({'error': 'identifier, role, and content are required'}), 400
    db    = require_db()
    q     = {'$or': [{'email': ident}, {'phone': ident}]}
    col   = db.workers if role == 'worker' else db.employers
    owner = col.find_one(q, {'_id': 1})
    if not owner:
        return jsonify({'error': 'User not found'}), 404
    oid  = to_oid(post_id)
    post = db.posts.find_one({'_id': oid}) if oid else None
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    if post['owner_id'] != owner['_id']:
        return jsonify({'error': '❌ You can only edit your own posts. Admins cannot modify user posts.'}), 403
    db.posts.update_one({'_id': oid}, {'$set': {
        'content': content, 'title': p.get('title', '').strip(),
        'post_type': p.get('post_type', post.get('post_type', 'achievement')),
        'updated_at': datetime.utcnow().isoformat(),
    }})
    return jsonify({'success': True, 'message': '✅ Post updated successfully'})


@app.route('/api/posts/<post_id>', methods=['DELETE'])
def api_delete_post(post_id):
    p     = request.get_json() or {}
    ident = p.get('identifier')
    role  = p.get('role')
    if not ident or not role:
        return jsonify({'error': 'identifier and role are required'}), 400
    db    = require_db()
    q     = {'$or': [{'email': ident}, {'phone': ident}]}
    col   = db.workers if role == 'worker' else db.employers
    owner = col.find_one(q, {'_id': 1})
    if not owner:
        return jsonify({'error': 'User not found'}), 404
    oid  = to_oid(post_id)
    post = db.posts.find_one({'_id': oid}) if oid else None
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    if post['owner_id'] != owner['_id']:
        return jsonify({'error': '❌ You can only delete your own posts. Admins cannot modify user posts.'}), 403
    db.posts.delete_one({'_id': oid})
    return jsonify({'success': True, 'message': '✅ Post deleted successfully'})


@app.route('/api/posts/photo', methods=['POST'])
def api_post_photo():
    p     = request.get_json() or {}
    ident = p.get('identifier')
    role  = p.get('role')
    post_id = p.get('post_id')
    photo = p.get('photo')

    if not ident or not role or not post_id or not photo:
        return jsonify({'error': 'identifier, role, post_id, and photo are required'}), 400

    # Parse base64 data URL
    try:
        if ',' in photo:
            header, data = photo.split(',', 1)
            ext = 'jpg'
            if 'png' in header:
                ext = 'png'
            elif 'gif' in header:
                ext = 'gif'
            elif 'webp' in header:
                ext = 'webp'
        else:
            data = photo
            ext  = 'jpg'
        img_bytes = base64.b64decode(data)
        if len(img_bytes) > 4 * 1024 * 1024:
            return jsonify({'error': 'Photo must be under 4MB'}), 400
    except Exception as e:
        return jsonify({'error': f'Invalid image data: {e}'}), 400

    db = require_db()
    q  = {'$or': [{'email': ident}, {'phone': ident}]}
    col = db.workers if role == 'worker' else db.employers
    owner = col.find_one(q, {'_id': 1})
    
    if not owner:
        return jsonify({'error': 'User not found'}), 404

    # Verify post ownership
    oid = to_oid(post_id)
    post = db.posts.find_one({'_id': oid}) if oid else None
    
    if not post or post['owner_id'] != owner['_id']:
        return jsonify({'error': 'Post not found or not yours'}), 404

    uid      = str(post['_id'])
    filename = f"post_{uid}.{ext}"
    filepath = os.path.join(UPLOAD_DIR, filename)

    with open(filepath, 'wb') as f:
        f.write(img_bytes)

    photo_url = f'/static/uploads/{filename}'
    
    # Update post with photo URL
    db.posts.update_one({'_id': oid}, {'$set': {'photo_url': photo_url}})
    
    return jsonify({'success': True, 'photo_url': photo_url})


# ---------------------------------------------------------------------------
# Post Interactions (Likes, Comments, Shares)
# ---------------------------------------------------------------------------

@app.route('/api/posts/<post_id>/like', methods=['POST'])
def api_toggle_like(post_id):
    p     = request.get_json() or {}
    ident = p.get('identifier')
    role  = p.get('role')
    
    if not ident or not role:
        return jsonify({'error': 'identifier and role are required'}), 400
    
    db = require_db()
    q  = {'$or': [{'email': ident}, {'phone': ident}]}
    col = db.workers if role == 'worker' else db.employers
    user = col.find_one(q, {'_id': 1})
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    oid = to_oid(post_id)
    if not oid:
        return jsonify({'error': 'Invalid post ID'}), 400
    
    # Check if post exists
    post = db.posts.find_one({'_id': oid})
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    # Check if user already liked this post
    existing_like = db.likes.find_one({
        'post_id': oid,
        'user_id': user['_id'],
        'user_role': role
    })
    
    if existing_like:
        # Unlike: remove the like
        db.likes.delete_one({'_id': existing_like['_id']})
        liked = False
    else:
        # Like: add the like
        db.likes.insert_one({
            'post_id': oid,
            'user_id': user['_id'],
            'user_role': role,
            'created_at': datetime.utcnow().isoformat()
        })
        liked = True
    
    # Get updated like count
    like_count = db.likes.count_documents({'post_id': oid})
    
    return jsonify({
        'success': True,
        'liked': liked,
        'like_count': like_count
    })


@app.route('/api/posts/<post_id>/likes', methods=['GET'])
def api_get_likes(post_id):
    oid = to_oid(post_id)
    if not oid:
        return jsonify({'error': 'Invalid post ID'}), 400
    
    db = require_db()
    
    # Check if post exists
    post = db.posts.find_one({'_id': oid})
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    # Get like count
    like_count = db.likes.count_documents({'post_id': oid})
    
    # Check if current user liked (if authenticated)
    liked = False
    ident = request.args.get('identifier')
    role = request.args.get('role')
    
    if ident and role:
        q = {'$or': [{'email': ident}, {'phone': ident}]}
        col = db.workers if role == 'worker' else db.employers
        user = col.find_one(q, {'_id': 1})
        if user:
            existing_like = db.likes.find_one({
                'post_id': oid,
                'user_id': user['_id'],
                'user_role': role
            })
            liked = existing_like is not None
    
    return jsonify({
        'like_count': like_count,
        'liked': liked
    })


@app.route('/api/posts/<post_id>/comment', methods=['POST'])
def api_add_comment(post_id):
    p       = request.get_json() or {}
    ident   = p.get('identifier')
    role    = p.get('role')
    content = p.get('content', '').strip()
    
    if not ident or not role or not content:
        return jsonify({'error': 'identifier, role, and content are required'}), 400
    
    if len(content) > 500:
        return jsonify({'error': 'Comment must be under 500 characters'}), 400
    
    db = require_db()
    q  = {'$or': [{'email': ident}, {'phone': ident}]}
    col = db.workers if role == 'worker' else db.employers
    user = col.find_one(q, {'_id': 1})
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    oid = to_oid(post_id)
    if not oid:
        return jsonify({'error': 'Invalid post ID'}), 400
    
    # Check if post exists
    post = db.posts.find_one({'_id': oid})
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    # Get user name for comment display
    if role == 'worker':
        user_name = f"{user.get('first_name', '')} {user.get('last_name', '')}".strip() or 'Worker'
        user_photo = user.get('photo_url')
    else:
        user_name = user.get('company_name') or user.get('contact_name') or 'Employer'
        user_photo = user.get('photo_url')
    
    # Add comment
    result = db.comments.insert_one({
        'post_id': oid,
        'user_id': user['_id'],
        'user_role': role,
        'user_name': user_name,
        'user_photo': user_photo,
        'content': content,
        'created_at': datetime.utcnow().isoformat()
    })
    
    return jsonify({
        'success': True,
        'comment_id': str(result.inserted_id),
        'comment': {
            'id': str(result.inserted_id),
            'user_name': user_name,
            'user_photo': user_photo,
            'content': content,
            'created_at': datetime.utcnow().isoformat()
        }
    })


@app.route('/api/posts/<post_id>/comments', methods=['GET'])
def api_get_comments(post_id):
    oid = to_oid(post_id)
    if not oid:
        return jsonify({'error': 'Invalid post ID'}), 400
    
    db = require_db()
    
    # Check if post exists
    post = db.posts.find_one({'_id': oid})
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    # Get comments
    comments = list(db.comments.find({'post_id': oid}).sort('created_at', 1))
    
    # Convert to dict format
    comments_data = []
    for comment in comments:
        comments_data.append({
            'id': str(comment['_id']),
            'user_name': comment.get('user_name', 'Anonymous'),
            'user_photo': comment.get('user_photo'),
            'content': comment['content'],
            'created_at': comment['created_at']
        })
    
    return jsonify(comments_data)


@app.route('/api/posts/<post_id>/share', methods=['POST'])
def api_share_post(post_id):
    p     = request.get_json() or {}
    ident = p.get('identifier')
    role  = p.get('role')
    
    if not ident or not role:
        return jsonify({'error': 'identifier and role are required'}), 400
    
    db = require_db()
    q  = {'$or': [{'email': ident}, {'phone': ident}]}
    col = db.workers if role == 'worker' else db.employers
    user = col.find_one(q, {'_id': 1})
    
    if not user:
        return jsonify({'error': 'User not found'}), 404
    
    oid = to_oid(post_id)
    if not oid:
        return jsonify({'error': 'Invalid post ID'}), 400
    
    # Check if post exists
    post = db.posts.find_one({'_id': oid})
    if not post:
        return jsonify({'error': 'Post not found'}), 404
    
    # Get user name for share display
    if role == 'worker':
        user_name = f"{user.get('first_name', '')} {user.get('last_name', '')}".strip() or 'Worker'
    else:
        user_name = user.get('company_name') or user.get('contact_name') or 'Employer'
    
    # Create shared post
    now = datetime.utcnow().isoformat()
    result = db.posts.insert_one({
        'owner_id': user['_id'],
        'owner_role': role,
        'post_type': 'share',
        'title': f"Shared {post.get('title', 'a post')}",
        'content': f"Shared from {post.get('owner_name', 'someone')}: {post.get('content', '')[:200]}{'...' if len(post.get('content', '')) > 200 else ''}",
        'original_post_id': oid,
        'created_at': now,
        'updated_at': now
    })
    
    # Record the share
    db.shares.insert_one({
        'post_id': oid,
        'shared_by_id': user['_id'],
        'shared_by_role': role,
        'shared_by_name': user_name,
        'shared_post_id': result.inserted_id,
        'created_at': now
    })
    
    return jsonify({
        'success': True,
        'shared_post_id': str(result.inserted_id)
    })


# ---------------------------------------------------------------------------
# Job Post / Apply
# ---------------------------------------------------------------------------
@app.route('/api/post-job', methods=['POST'])
def api_post_job():
    p = request.get_json() or {}
    if not all(p.get(f) for f in ['title','employer','city','category','contact_number','contact_email']):
        return jsonify({'error': 'Missing required job fields'}), 400
    db          = require_db()
    employer_id = None
    if p.get('employer_identifier'):
        emp = db.employers.find_one({'$or':[{'email':p['employer_identifier']},{'phone':p['employer_identifier']}]})
        if emp:
            employer_id = emp['_id']
    result = db.jobs.insert_one({
        'title': p['title'], 'employer': p['employer'], 'city': p['city'],
        'salary': p.get('salary'), 'type': p.get('type'), 'category': p.get('category'),
        'description': p.get('description'), 'contact_number': p.get('contact_number'),
        'contact_email': p.get('contact_email'), 'employer_id': employer_id,
        'posted_at': datetime.utcnow().isoformat(),
    })
    return jsonify({'success': True, 'job_id': str(result.inserted_id)})


@app.route('/api/apply-job', methods=['POST'])
def api_apply_job():
    p      = request.get_json() or {}
    job_id = p.get('job_id')
    ident  = p.get('identifier')
    if not job_id or not ident:
        return jsonify({'error': 'job_id and worker identifier are required'}), 400
    db     = require_db()
    worker = db.workers.find_one({'$or':[{'email':ident},{'phone':ident}]})
    if not worker:
        return jsonify({'error': 'Worker not found. Please login as a registered worker.'}), 404
    job_oid = to_oid(job_id)
    job     = db.jobs.find_one({'_id': job_oid}) if job_oid else None
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    if db.applications.find_one({'job_id': job_oid, 'worker_id': worker['_id']}):
        return jsonify({'error': 'You have already applied for this job.'}), 400
    now = datetime.utcnow().isoformat()
    db.applications.insert_one({
        'job_id': job_oid, 'worker_id': worker['_id'],
        'status': 'pending', 'status_updated_at': now, 'status_message': None, 'created_at': now,
    })
    return jsonify({'success': True, 'message': '✅ Application submitted successfully. The employer will see it in their profile.'})


# ---------------------------------------------------------------------------
# Applications & Offers
# ---------------------------------------------------------------------------
@app.route('/api/employer/applications', methods=['POST'])
def api_employer_applications():
    p     = request.get_json() or {}
    ident = p.get('identifier')
    if not ident:
        return jsonify({'error': 'Employer identifier is required'}), 400
    db  = require_db()
    emp = db.employers.find_one({'$or':[{'email':ident},{'phone':ident}]})
    if not emp:
        return jsonify({'error': 'Employer not found'}), 404
    jobs      = {j['_id']: j for j in db.jobs.find({'employer_id': emp['_id']})}
    if not jobs:
        return jsonify([])
    apps      = list(db.applications.find({'job_id': {'$in': list(jobs.keys())}}))
    w_ids     = list({a['worker_id'] for a in apps})
    workers   = {w['_id']: w for w in db.workers.find({'_id': {'$in': w_ids}})}
    data = []
    for a in sorted(apps, key=lambda x: x.get('created_at',''), reverse=True):
        job    = jobs.get(a['job_id'], {})
        worker = workers.get(a['worker_id'], {})
        data.append({
            'application_id': str(a['_id']), 'job_id': str(a['job_id']),
            'worker_id': str(a['worker_id']), 'status': a.get('status'),
            'status_updated_at': a.get('status_updated_at'), 'status_message': a.get('status_message'),
            'created_at': a.get('created_at'), 'job_title': job.get('title'),
            'job_city': job.get('city'), 'job_type': job.get('type'),
            'worker_name': f"{worker.get('first_name','')} {worker.get('last_name','')}".strip(),
            'worker_role': worker.get('role'), 'worker_category': worker.get('category'),
            'worker_city': worker.get('city'), 'worker_phone': worker.get('phone'),
            'worker_email': worker.get('email'),
        })
    return jsonify(data)


@app.route('/api/worker/applications', methods=['POST'])
def api_worker_applications():
    p     = request.get_json() or {}
    ident = p.get('identifier')
    if not ident:
        return jsonify({'error': 'Worker identifier is required'}), 400
    db     = require_db()
    worker = db.workers.find_one({'$or':[{'email':ident},{'phone':ident}]})
    if not worker:
        return jsonify({'error': 'Worker not found'}), 404
    apps      = list(db.applications.find({'worker_id': worker['_id']}))
    j_ids     = list({a['job_id'] for a in apps})
    jobs_map  = {j['_id']: j for j in db.jobs.find({'_id': {'$in': j_ids}})}
    emp_ids   = list({j.get('employer_id') for j in jobs_map.values() if j.get('employer_id')})
    emps_map  = {e['_id']: e for e in db.employers.find({'_id': {'$in': emp_ids}})} if emp_ids else {}
    data = []
    for a in sorted(apps, key=lambda x: x.get('created_at',''), reverse=True):
        job = jobs_map.get(a['job_id'], {})
        emp = emps_map.get(job.get('employer_id'), {})
        data.append({
            'application_id': str(a['_id']), 'job_id': str(a['job_id']),
            'status': a.get('status'), 'status_updated_at': a.get('status_updated_at'),
            'status_message': a.get('status_message'), 'created_at': a.get('created_at'),
            'job_title': job.get('title'),
            'employer_name': emp.get('company_name') or job.get('employer'),
            'job_city': job.get('city'), 'job_type': job.get('type'),
        })
    return jsonify(data)


@app.route('/api/employer/offers', methods=['POST'])
def api_employer_offers():
    p     = request.get_json() or {}
    ident = p.get('identifier')
    if not ident:
        return jsonify({'error': 'Employer identifier is required'}), 400
    db  = require_db()
    emp = db.employers.find_one({'$or':[{'email':ident},{'phone':ident}]})
    if not emp:
        return jsonify({'error': 'Employer not found'}), 404
    offers  = list(db.worker_offers.find({'employer_id': emp['_id']}))
    w_ids   = list({o['worker_id'] for o in offers})
    workers = {w['_id']: w for w in db.workers.find({'_id': {'$in': w_ids}})}
    data = []
    for o in sorted(offers, key=lambda x: x.get('created_at',''), reverse=True):
        worker = workers.get(o['worker_id'], {})
        data.append({
            'offer_id': str(o['_id']), 'worker_id': str(o['worker_id']),
            'message': o.get('message'), 'status': o.get('status'),
            'status_updated_at': o.get('status_updated_at'), 'created_at': o.get('created_at'),
            'worker_name': f"{worker.get('first_name','')} {worker.get('last_name','')}".strip(),
            'worker_role': worker.get('role'), 'worker_city': worker.get('city'),
            'worker_phone': worker.get('phone'), 'worker_email': worker.get('email'),
        })
    return jsonify(data)


@app.route('/api/worker/offers', methods=['POST'])
def api_worker_offers():
    p     = request.get_json() or {}
    ident = p.get('identifier')
    if not ident:
        return jsonify({'error': 'Worker identifier is required'}), 400
    db     = require_db()
    worker = db.workers.find_one({'$or':[{'email':ident},{'phone':ident}]})
    if not worker:
        return jsonify({'error': 'Worker not found'}), 404
    offers    = list(db.worker_offers.find({'worker_id': worker['_id']}))
    emp_ids   = list({o['employer_id'] for o in offers})
    emps_map  = {e['_id']: e for e in db.employers.find({'_id': {'$in': emp_ids}})} if emp_ids else {}
    data = []
    for o in sorted(offers, key=lambda x: x.get('created_at',''), reverse=True):
        emp = emps_map.get(o['employer_id'], {})
        data.append({
            'offer_id': str(o['_id']), 'employer_id': str(o['employer_id']),
            'message': o.get('message'), 'status': o.get('status'),
            'status_updated_at': o.get('status_updated_at'), 'created_at': o.get('created_at'),
            'employer_name': emp.get('company_name') or emp.get('contact_name') or 'Employer',
            'employer_type': emp.get('employer_type') or 'N/A',
            'employer_description': emp.get('description') or 'No additional details provided.',
            'employer_phone': emp.get('phone'), 'employer_email': emp.get('email'),
            'employer_city': emp.get('city'), 'employer_state': emp.get('state'),
        })
    return jsonify(data)


@app.route('/api/offer/update-status', methods=['POST'])
def api_offer_update_status():
    p      = request.get_json() or {}
    ident  = p.get('identifier')
    o_id   = p.get('offer_id')
    status = (p.get('status') or '').lower()
    msg    = p.get('message')
    if not ident or not o_id or status not in ('offered','accepted','rejected','pending','withdrawn'):
        return jsonify({'error': 'identifier, offer_id, and valid status are required'}), 400
    db       = require_db()
    employer = db.employers.find_one({'$or':[{'email':ident},{'phone':ident}]})
    worker   = db.workers.find_one({'$or':[{'email':ident},{'phone':ident}]})
    if not employer and not worker:
        return jsonify({'error': 'Employer or worker not found'}), 404
    oid   = to_oid(o_id)
    offer = db.worker_offers.find_one({'_id': oid}) if oid else None
    if not offer:
        return jsonify({'error': 'Offer not found'}), 404
    now = datetime.utcnow().isoformat()
    db.worker_offers.update_one({'_id': oid}, {'$set': {'status': status, 'status_updated_at': now, 'message': msg}})
    return jsonify({'success': True, 'message': f'Offer status updated to {status}.'})


@app.route('/api/offer/delete', methods=['POST'])
def api_offer_delete():
    p     = request.get_json() or {}
    ident = p.get('identifier')
    o_id  = p.get('offer_id')
    if not ident or not o_id:
        return jsonify({'error': 'identifier and offer_id are required'}), 400
    db  = require_db()
    oid = to_oid(o_id)
    if not oid:
        return jsonify({'error': 'Invalid offer id'}), 400
    db.worker_offers.delete_one({'_id': oid})
    return jsonify({'success': True, 'message': 'Offer deleted successfully.'})


@app.route('/api/offer/update', methods=['POST'])
def api_offer_update():
    p     = request.get_json() or {}
    ident = p.get('identifier')
    o_id  = p.get('offer_id')
    message = p.get('message','').strip()
    if not ident or not o_id:
        return jsonify({'error': 'identifier and offer_id are required'}), 400
    if not message:
        return jsonify({'error': 'message is required'}), 400
    db  = require_db()
    oid = to_oid(o_id)
    if not oid:
        return jsonify({'error': 'Invalid offer id'}), 400
    # Check ownership
    offer = db.worker_offers.find_one({'_id': oid})
    if not offer:
        return jsonify({'error': 'Offer not found'}), 404
    employer = db.employers.find_one({'$or':[{'email':ident},{'phone':ident}]})
    if not employer or str(offer.get('employer_id')) != str(employer.get('_id')):
        return jsonify({'error': 'Unauthorized'}), 403
    db.worker_offers.update_one({'_id': oid}, {'$set': {'message': message}})
    return jsonify({'success': True, 'message': 'Offer updated successfully.'})


@app.route('/api/application/update-status', methods=['POST'])
def api_application_update_status():
    p      = request.get_json() or {}
    ident  = p.get('identifier')
    app_id = p.get('application_id')
    status = (p.get('status') or '').lower()
    msg    = p.get('message')
    if not ident or not app_id or status not in ('accepted','rejected','pending'):
        return jsonify({'error': 'identifier, application_id, and valid status are required'}), 400
    db  = require_db()
    emp = db.employers.find_one({'$or':[{'email':ident},{'phone':ident}]})
    if not emp:
        return jsonify({'error': 'Employer not found'}), 404
    oid     = to_oid(app_id)
    app_row = db.applications.find_one({'_id': oid}) if oid else None
    if not app_row:
        return jsonify({'error': 'Application not found'}), 404
    now = datetime.utcnow().isoformat()
    db.applications.update_one({'_id': oid}, {'$set': {'status': status, 'status_updated_at': now, 'status_message': msg}})
    return jsonify({'success': True, 'message': f'Application status updated to {status}.'})


@app.route('/api/application/delete', methods=['POST'])
def api_application_delete():
    p      = request.get_json() or {}
    ident  = p.get('identifier')
    app_id = p.get('application_id')
    if not ident or not app_id:
        return jsonify({'error': 'identifier and application_id are required'}), 400
    db  = require_db()
    oid = to_oid(app_id)
    if not oid:
        return jsonify({'error': 'Invalid application id'}), 400
    db.applications.delete_one({'_id': oid})
    return jsonify({'success': True, 'message': 'Application deleted successfully.'})


@app.route('/api/application/update', methods=['POST'])
def api_application_update():
    p      = request.get_json() or {}
    ident  = p.get('identifier')
    app_id = p.get('application_id')
    message = p.get('message','').strip()
    if not ident or not app_id:
        return jsonify({'error': 'identifier and application_id are required'}), 400
    if not message:
        return jsonify({'error': 'message is required'}), 400
    db  = require_db()
    oid = to_oid(app_id)
    if not oid:
        return jsonify({'error': 'Invalid application id'}), 400
    # Check ownership
    app = db.applications.find_one({'_id': oid})
    if not app:
        return jsonify({'error': 'Application not found'}), 404
    worker = db.workers.find_one({'$or':[{'email':ident},{'phone':ident}]})
    if not worker or str(app.get('worker_id')) != str(worker.get('_id')):
        return jsonify({'error': 'Unauthorized'}), 403
    db.applications.update_one({'_id': oid}, {'$set': {'message': message}})
    return jsonify({'success': True, 'message': 'Application updated successfully.'})


@app.route('/api/contact-worker', methods=['POST'])
def api_contact_worker():
    p     = request.get_json() or {}
    w_id  = p.get('worker_id')
    e_id  = p.get('employer_identifier')
    msg   = p.get('message','').strip()
    if not w_id or not e_id:
        return jsonify({'error': 'worker_id and employer_identifier are required'}), 400
    db     = require_db()
    w_oid  = to_oid(w_id)
    worker = db.workers.find_one({'_id': w_oid}) if w_oid else None
    if not worker:
        return jsonify({'error': 'Worker not found'}), 404
    emp = db.employers.find_one({'$or':[{'email':e_id},{'phone':e_id}]})
    if not emp:
        return jsonify({'error': 'Employer not found. Please login as a registered employer.'}), 404
    now = datetime.utcnow().isoformat()
    db.worker_offers.insert_one({
        'employer_id': emp['_id'], 'worker_id': worker['_id'],
        'message': msg or 'Employer expressed interest.',
        'status': 'offered', 'status_updated_at': now, 'created_at': now,
    })
    wname = f"{worker['first_name']} {worker['last_name']}"
    return jsonify({'success': True, 'message': f'✅ Interest registered for {wname}! They will see the offer in their profile.'})


@app.route('/api/contact', methods=['POST'])
def api_contact():
    p = request.get_json() or {}
    if not p.get('name') or not p.get('contact') or not p.get('message'):
        return jsonify({'error': 'Missing contact data'}), 400
    db = require_db()
    db.contacts.insert_one({'name': p['name'], 'contact': p['contact'], 'subject': p.get('subject'), 'message': p['message'], 'created_at': datetime.utcnow().isoformat()})
    return jsonify({'success': True})




def create_chatbot_response(message):
    message_clean = message.strip()
    if not message_clean:
        return 'Please ask me something!'

    normalized = message_clean.lower()
    section_map = {
        'job': 'Find Jobs',
        'work': 'Find Jobs',
        'worker': 'Find Workers',
        'hire': 'Find Workers',
        'post': 'Posts',
        'feed': 'Posts',
        'register': 'Register Free',
        'sign up': 'Register Free',
        'login': 'Sign In',
        'sign in': 'Sign In',
        'profile': 'Profile',
        'contact': 'Contact',
        'help': 'Contact',
        'support': 'Contact',
        'occupation': 'Occupations',
        'nco': 'Occupations'
    }

    matched_sections = [label for keyword, label in section_map.items() if keyword in normalized]
    matched_sections = list(dict.fromkeys(matched_sections))

    suggestions = matched_sections or random.sample([
        'Find Jobs',
        'Find Workers',
        'Posts',
        'Register Free',
        'Profile',
        'Contact'
    ], 2)

    response_templates = [
        'Thanks for asking about "{message}". On SkillMatch, you can explore {sections} to get what you need.',
        'I heard you asking "{message}". Try visiting {sections} on SkillMatch and I can guide you further.',
        'Great question about "{message}". SkillMatch can help with {sections}, and I can help you find the right page.',
        'That sounds like something SkillMatch can support. Check out {sections} and let me know if you want directions.'
    ]

    if len(suggestions) == 1:
        sections_text = suggestions[0]
    elif len(suggestions) == 2:
        sections_text = ' and '.join(suggestions)
    else:
        sections_text = ', '.join(suggestions[:-1]) + ' and ' + suggestions[-1]
    return random.choice(response_templates).format(message=message_clean, sections=sections_text)


@app.route('/api/chatbot', methods=['POST'])
def api_chatbot():
    try:
        p = request.get_json() or {}
        message = p.get('message', '').strip()
        response = create_chatbot_response(message)
        return jsonify({'response': response})
    except Exception:
        return jsonify({'response': 'Sorry, I am having trouble answering that right now. Please try again later.'}), 500





# ---------------------------------------------------------------------------
# AI Chatbot Proxy — keeps API key safe on server side
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# Gemini API keys — add as many as you want, system rotates automatically
# Get free keys at: https://aistudio.google.com/app/apikey
# Each Google account gives you a fresh free quota
# ---------------------------------------------------------------------------
GEMINI_KEYS = [
    key.strip()
    for key in [
        os.environ.get('GEMINI_API_KEY', ''),
        os.environ.get('GEMINI_API_KEY_1', ''),
        os.environ.get('GEMINI_API_KEY_2', ''),
        os.environ.get('GEMINI_API_KEY_3', ''),
        # Add more keys here for rotation (get free keys at aistudio.google.com):
        # 'AIzaSyYOUR_SECOND_KEY_HERE',
        # 'AIzaSyYOUR_THIRD_KEY_HERE',
    ]
    if key.strip() and key.strip() not in ('', 'YOUR_GEMINI_API_KEY_HERE')
]

# Track which key index to use next (round-robin across requests)
_gemini_key_index = 0

GEMINI_MODELS = [
    'gemini-2.5-flash',
    'gemini-1.5-flash',
]

def _call_gemini(api_key, model, gemini_contents):
    """Try one Gemini API call. Returns reply string or raises exception."""
    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=model,
        contents=gemini_contents,
        config={'maxOutputTokens': 1000, 'temperature': 0.7},
    )
    reply = response.text
    if not reply:
        raise ValueError('Empty response from Gemini')
    return reply


@app.route('/api/chat', methods=['POST'])
def api_chat():
    import urllib.error, json as _json
    global _gemini_key_index

    p = request.get_json() or {}
    messages = p.get('messages', [])
    lang = p.get('lang', 'en')
    if not messages:
        return jsonify({'error': 'No messages provided'}), 400

    lang_note = {
        'hi': 'Reply in Hindi.',
        'mr': 'Reply in Marathi.',
        'bn': 'Reply in Bengali.',
        'ta': 'Reply in Tamil.',
        'te': 'Reply in Telugu.',
        'gu': 'Reply in Gujarati.',
        'kn': 'Reply in Kannada.',
        'pa': 'Reply in Punjabi.',
        'ur': 'Reply in Urdu.',
    }.get(lang, '')

    system_instruction = (
        "You are the friendly, knowledgeable AI assistant for SkillMatch — "
        "India's blue-collar and domestic worker hiring platform. "
        "Help workers find jobs and help employers find workers. "
        "Keep answers helpful and clear. Use bullet points for steps. "
        + lang_note
    )

    # Convert history to Gemini format (uses 'model' instead of 'assistant')
    gemini_contents = [{'role': 'user', 'parts': [{'text': system_instruction}]}]
    for msg in messages:
        role = msg.get('role', 'user')
        role = 'model' if role in ('assistant', 'model', 'ai') else 'user'
        gemini_contents.append({'role': role, 'parts': [{'text': msg.get('content', '')}]})

    if not GEMINI_KEYS:
        return jsonify({'reply': (
            "⚠️ No Gemini API key configured. "
            "Add your key in app.py (GEMINI_KEYS list) or set GEMINI_API_KEY_1 environment variable. "
            "Get a free key at https://aistudio.google.com/app/apikey"
        )})

    # Try every key × every model until one works
    total_keys = len(GEMINI_KEYS)
    last_error = ''
    for attempt in range(total_keys * len(GEMINI_MODELS)):
        key_idx  = (attempt // len(GEMINI_MODELS)) % total_keys
        # Start from the last-used key for fair rotation
        real_key_idx = (_gemini_key_index + key_idx) % total_keys
        model    = GEMINI_MODELS[attempt % len(GEMINI_MODELS)]
        api_key  = GEMINI_KEYS[real_key_idx]

        try:
            reply = _call_gemini(api_key, model, gemini_contents)
            # Remember successful key for next request
            _gemini_key_index = real_key_idx
            return jsonify({'reply': reply})

        except urllib.error.HTTPError as e:
            body = e.read().decode('utf-8', errors='ignore')
            last_error = body
            # 429 = quota exceeded → try next key/model
            # 404 = model not found → try next model
            # Other errors → also try next
            continue
        except Exception as ex:
            last_error = str(ex)
            continue

    # All keys and models exhausted — rotate key index for next request
    _gemini_key_index = (_gemini_key_index + 1) % total_keys
    return jsonify({'reply': f"API Error: {last_error}"})

if __name__ == '__main__':
    app.run(debug=True)