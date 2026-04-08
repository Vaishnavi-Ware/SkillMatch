# SkillMatch
SkillMatch is a full-stack platform connecting local job seekers with employers. It features secure database management, AI chatbot guidance, multilingual voice assistant, and responsive design, enabling users to search, apply, and manage jobs efficiently.

> **India's blue-collar job marketplace** — connecting domestic workers, skilled tradespeople, and labourers with families and employers across India.

![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)
![Flask](https://img.shields.io/badge/Flask-3.x-black?logo=flask)
![MongoDB](https://img.shields.io/badge/MongoDB-Atlas-green?logo=mongodb)
![License](https://img.shields.io/badge/License-ISC-lightgrey)

---

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Access Control](#access-control)
- [Default Credentials](#default-credentials)
-
---

## Overview

SkillMatch is a full-stack web platform built for India's blue-collar workforce. Workers — cooks, electricians, plumbers, drivers, housemaids, nannies, security guards, and more — can register, build profiles, and get discovered by employers. Families and businesses can post jobs, browse verified workers, and send direct hiring offers.

The platform is built as a **single-page application** served by a **Flask backend**, backed by **MongoDB Atlas**, with an integrated **Gemini AI chatbot** supporting 10 Indian languages.

---

## Features

### For Workers
- Register with skills, experience, city, and expected salary
- Upload an Aadhaar/PAN ID proof and profile photo
- Browse and apply to job listings with one click
- Receive and respond to hiring offers from employers
- Share achievements and updates on the community feed

### For Employers (Families & Businesses)
- Post job listings with salary, location, and contact details
- Search and filter workers by category, city, and availability
- Send direct hiring offers with a custom message
- Manage incoming applications and update their status
- View worker public profiles and posts

### Platform
- **AI Chatbot** — Gemini-powered assistant with support for English, Hindi, Marathi, Bengali, Tamil, Telugu, Gujarati, Kannada, Punjabi, and Urdu
- **Voice Input** — Web Speech API integration on all form fields, language-aware
- **Multilingual UI** — 7 languages switchable from the navbar
- **Community Feed** — posts, likes, comments, and shares between users
- **NCO Classification** — full National Classification of Occupations browser
- **Role-based Access Control** — workers, employers, and admins each have scoped permissions
- **Cascade Deletes** — account deletion cleans up all associated records
- **Admin Dashboard** — manage all workers, employers, jobs, and posts

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3.11, Flask |
| Database | MongoDB Atlas (via PyMongo) |
| AI | Google Gemini API (`gemini-2.5-flash`, `gemini-1.5-flash`) |
| Frontend | Vanilla JS, HTML5, CSS3 (single-page, no framework) |
| Auth | Werkzeug password hashing, security question recovery |
| Hosting | Runs locally or on any WSGI-compatible host |

---

## Project Structure

```
SkillMatch/
├── app.py                  # Flask backend — all API routes and business logic
├── skillmatch.html         # Single-page frontend (HTML + CSS + JS)
├── static/
│   ├── app.js              # Frontend JavaScript (workers, jobs, posts, chatbot)
│   └── uploads/            # User-uploaded profile photos and post images
├── requirements.txt        # Python dependencies
├── .env                    # Environment variables (never commit this)
└── .env.template           # Safe template for .env
```

---

## Getting Started

### Prerequisites

- Python 3.11+
- A [MongoDB Atlas](https://www.mongodb.com/atlas) free-tier cluster
- A [Google AI Studio](https://aistudio.google.com/app/apikey) API key (free)

---


```

### 1. Set up the Python environment

```bash
python -m venv venv

# Windows
venv\Scripts\activate

# macOS / Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Configure environment variables

```bash
cp .env.template .env
```

Edit `.env` with your credentials — see [Environment Variables](#environment-variables) below.

### 5. Run the Flask server

```bash
python app.py
```

The app will be available at `http://localhost:5000`.

---

## Environment Variables

Create a `.env` file in the project root. **Never commit this file.**

```env
# ── MongoDB ──────────────────────────────────────────────────
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/
MONGO_DB_NAME=skillmatch

# ── Gemini AI (get a free key at aistudio.google.com) ────────
GEMINI_API_KEY=your-gemini-api-key
GEMINI_API_KEY_1=your-second-key   # optional — enables key rotation
GEMINI_API_KEY_2=your-third-key    # optional

# ── App ───────────────────────────────────────────────────────
SITE_URL=http://localhost:5000
```

---

## API Reference

All endpoints are served under `/api/`. The server returns JSON for all routes.

### Authentication

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/register` | Register a worker, employer, or admin |
| `POST` | `/api/login` | Login and get role confirmation |
| `POST` | `/api/profile` | Fetch authenticated user's profile |
| `POST` | `/api/profile/update` | Update profile fields |

### Workers & Jobs

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/workers` | List / search workers (public) |
| `GET` | `/api/jobs` | List / search jobs (public) |
| `POST` | `/api/post-job` | Post a new job listing |
| `POST` | `/api/apply-job` | Apply to a job |
| `POST` | `/api/contact-worker` | Send a hiring offer to a worker |
| `POST` | `/api/public-profile` | View any worker or employer's public profile |
| `POST` | `/api/upload-photo` | Upload a profile photo (base64) |

### Applications & Offers

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/worker/applications` | Worker's sent applications |
| `POST` | `/api/employer/applications` | Applications received by employer |
| `POST` | `/api/application/update-status` | Employer accepts / rejects an application |
| `POST` | `/api/application/delete` | Delete an application |
| `POST` | `/api/worker/offers` | Offers received by a worker |
| `POST` | `/api/employer/offers` | Offers sent by an employer |
| `POST` | `/api/offer/update-status` | Update offer status |
| `POST` | `/api/offer/delete` | Delete an offer |

### Posts & Community Feed

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/posts/all` | Fetch all community posts with interaction counts |
| `POST` | `/api/posts` | Create a new post |
| `POST` | `/api/posts/my` | Fetch current user's own posts |
| `PUT` | `/api/posts/<id>` | Edit own post |
| `DELETE` | `/api/posts/<id>` | Delete own post |
| `POST` | `/api/posts/<id>/like` | Toggle like on a post |
| `GET` | `/api/posts/<id>/likes` | Get like count and status |
| `POST` | `/api/posts/<id>/comment` | Add a comment |
| `GET` | `/api/posts/<id>/comments` | Get all comments |
| `POST` | `/api/posts/<id>/share` | Share a post to your profile |
| `POST` | `/api/posts/photo` | Attach a photo to a post |

### Self-Service Account Management

| Method | Endpoint | Description |
|---|---|---|
| `PUT` | `/api/worker/profile` | Worker updates their own profile |
| `DELETE` | `/api/worker/profile` | Worker deletes their own account (cascade) |
| `PUT` | `/api/employer/profile` | Employer updates their own profile |
| `DELETE` | `/api/employer/profile` | Employer deletes their own account (cascade) |

### Admin (Authenticated Admin Only)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/admin/workers` | List all workers |
| `GET` | `/api/admin/employers` | List all employers |
| `GET` | `/api/admin/jobs` | List all jobs |
| `GET` | `/api/admin/posts` | List all posts |
| `POST` | `/api/admin/edit-worker-auth` | Edit any worker's profile |
| `POST` | `/api/admin/edit-employer-auth` | Edit any employer's profile |
| `POST` | `/api/admin/delete-worker-auth` | Delete a worker (cascade) |
| `POST` | `/api/admin/delete-employer-auth` | Delete an employer (cascade) |
| `POST` | `/api/admin/delete-job-auth` | Delete a job listing |
| `POST` | `/api/admin/delete-post-auth` | Delete any post |

### Other

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/nco` | National Classification of Occupations groups |
| `POST` | `/api/contact` | Submit a contact form message |
| `POST` | `/api/chatbot` | Keyword-based chatbot fallback |
| `POST` | `/api/chat` | Gemini AI chatbot (full conversation history) |

---

## Access Control

SkillMatch enforces role-based access control on all mutating operations.

| Role | Own Profile | Own Posts | Others' Content | Admin Endpoints |
|---|---|---|---|---|
| **Worker** | ✅ Edit / Delete | ✅ Edit / Delete | ❌ | ❌ |
| **Employer** | ✅ Edit / Delete | ✅ Edit / Delete | ❌ | ❌ |
| **Admin** | ✅ Full access | ✅ Full access | ✅ Full access | ✅ |

All admin-authenticated endpoints require `admin_identifier` and `admin_role: "admin"` in the request body and verify against the `admins` collection.

---

<p align="center">Made with ❤️ for India's workers</p>
