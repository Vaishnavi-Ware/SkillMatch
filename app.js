const API_BASE = '';
let workers = [];
let jobs = [];
let ncoGroups = [];
let currentWorkerFilter = '';
let currentJobFilter = '';
let currentUser = null;

function initApp() {
  return Promise.all([loadWorkers(), loadJobs(), loadNCO()]).then(() => {
    renderFeaturedWorkers();
    renderRecentJobs();
  });
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    const error = await res.json().catch(() => ({}));
    throw new Error(error.error || error.message || 'Server error');
  }
  return res.json();
}

function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.style.background = isError ? '#c23d32' : 'var(--text-dark)';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

async function loadWorkers(search = '') {
  const city = document.getElementById('workerCity')?.value || '';
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (currentWorkerFilter) params.set('category', currentWorkerFilter);
  if (city) params.set('city', city);
  workers = await fetchJson(`/api/workers?${params.toString()}`);
  renderWorkers();
}

async function loadJobs(search = '') {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (currentJobFilter) params.set('category', currentJobFilter);
  jobs = await fetchJson(`/api/jobs?${params.toString()}`);
  renderJobs();
}

async function loadNCO() {
  ncoGroups = await fetchJson('/api/nco');
}

function showPage(id) {
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach((a) => a.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  const navEl = document.getElementById('nav-' + id);
  if (navEl) navEl.classList.add('active');
  window.scrollTo(0, 0);
  if (id === 'find-workers') loadWorkers(document.getElementById('workerSearch')?.value || '');
  if (id === 'find-jobs') loadJobs(document.getElementById('jobSearch')?.value || '');
  if (id === 'nco') renderNCO();
  if (id === 'admin') renderAdminDashboard();
  if (id === 'profile') renderProfile();
  if (id === 'post-job') prefillJobPostForm();
}

async function prefillJobPostForm() {
  if (!currentUser || currentUser.role !== 'employer') return;
  const employerField = document.getElementById('jobEmployer');
  const contactField = document.getElementById('jobContact');
  const emailField = document.getElementById('jobContactEmail');
  if (!employerField && !contactField && !emailField) return;
  if (employerField?.value.trim() && contactField?.value.trim() && emailField?.value.trim()) return;
  try {
    const data = await fetchJson('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'employer', identifier: currentUser.identifier }),
    });
    if (employerField && !employerField.value.trim()) {
      employerField.value = data.company_name || data.contact_name || '';
    }
    if (contactField && !contactField.value.trim()) {
      contactField.value = data.phone || '';
    }
    if (emailField && !emailField.value.trim()) {
      emailField.value = data.email || '';
    }
    currentUser.profile = data;
  } catch (err) {
    // ignore profile loading errors
  }
}

function openModal() {
  document.getElementById('modal').classList.add('open');
}

function closeModal(e) {
  if (!e || e.target === document.getElementById('modal')) {
    document.getElementById('modal').classList.remove('open');
  }
}

function setRole(el) {
  document.querySelectorAll('.role-btn').forEach((b) => b.classList.remove('active'));
  el.classList.add('active');
}

function getActiveLoginRole() {
  return document.querySelector('.role-btn.active')?.dataset.role || 'worker';
}

function setMode(el, mode) {
  document.querySelectorAll('.mode-btn').forEach((b) => b.classList.remove('active'));
  el.classList.add('active');
}

function setSignedInState(role, identifier) {
  currentUser = { role, identifier };
  document.getElementById('logoutBtn')?.style.setProperty('display', 'inline-flex');
  document.getElementById('profileBtn')?.style.setProperty('display', 'inline-flex');
  document.getElementById('signInBtn')?.style.setProperty('display', 'none');
  document.getElementById('registerBtn')?.style.setProperty('display', 'none');
  if (role === 'admin') {
    document.getElementById('adminDashboardBtn')?.style.setProperty('display', 'inline-flex');
  }
}

async function doLogin() {
  const identifier = document.getElementById('loginUser')?.value.trim();
  const password = document.getElementById('loginPassword')?.value;
  const role = getActiveLoginRole();
  if (!identifier || !password) {
    toast('Please enter email/phone and password', true);
    return;
  }
  try {
    const data = await fetchJson('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password, role }),
    });
    setSignedInState(data.role, identifier);
    closeModal();
    if (data.role === 'admin') {
      toast('✅ Admin signed in successfully!');
      showPage('admin');
      return;
    }
    toast('✅ Signed in successfully!');
    showPage('profile');
  } catch (err) {
    toast(err.message, true);
  }
}

async function doRegister() {
  const tab = document.querySelector('.form-tab.active')?.textContent || '';
  const isWorker = tab.includes('Worker');
  const isAdmin = tab.includes('Administrator');
  const payload = { type: isAdmin ? 'admin' : isWorker ? 'worker' : 'employer' };
  if (isWorker) {
    payload.first_name = document.getElementById('workerFirstName')?.value.trim();
    payload.last_name = document.getElementById('workerLastName')?.value.trim();
    payload.role = document.getElementById('workerCategory')?.value.trim();
    payload.category = document.getElementById('workerCategory')?.value.trim();
    payload.city = document.getElementById('workerCurrentCity')?.value.trim();
    payload.state = document.getElementById('workerState')?.value.trim();
    payload.experience_years = document.getElementById('workerExperience')?.value;
    payload.salary_expected = document.getElementById('workerSalary')?.value.trim();
    payload.skills = document.getElementById('workerSkills')?.value.trim();
    payload.phone = document.getElementById('workerPhone')?.value.trim();
    payload.email = document.getElementById('workerEmail')?.value.trim();
    payload.password = document.getElementById('workerPassword')?.value;
    const confirm = document.getElementById('workerConfirmPassword')?.value;
    payload.security_question = document.getElementById('workerSecurityQuestion')?.value;
    payload.security_answer = document.getElementById('workerSecurityAnswer')?.value.trim();
    if (!payload.password || payload.password !== confirm) {
      toast('Passwords do not match', true);
      return;
    }
    payload.icon = '👷';
  } else if (isAdmin) {
    payload.name = document.getElementById('adminName')?.value.trim();
    payload.phone = document.getElementById('adminPhone')?.value.trim();
    payload.email = document.getElementById('adminEmail')?.value.trim();
    payload.password = document.getElementById('adminPassword')?.value;
    const confirm = document.getElementById('adminConfirmPassword')?.value;
    if (!payload.name || !payload.password) {
      toast('Please fill out admin name and password.', true);
      return;
    }
    if (payload.password !== confirm) {
      toast('Passwords do not match', true);
      return;
    }
  } else {
    payload.contact_name = document.getElementById('employerContactName')?.value.trim();
    payload.company_name = document.getElementById('employerCompanyName')?.value.trim();
    payload.employer_type = document.getElementById('employerType')?.value;
    payload.phone = document.getElementById('employerPhone')?.value.trim();
    payload.email = document.getElementById('employerEmail')?.value.trim();
    payload.city = document.getElementById('employerCity')?.value.trim();
    payload.state = document.getElementById('employerState')?.value;
    payload.workers_needed = document.getElementById('employerWorkersNeeded')?.value;
    payload.description = document.getElementById('employerDescription')?.value.trim();
    payload.password = document.getElementById('employerPassword')?.value;
    const confirm = document.getElementById('employerConfirmPassword')?.value;
    if (!payload.password || payload.password !== confirm) {
      toast('Passwords do not match', true);
      return;
    }
  }
  try {
    await fetchJson('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    toast('✅ Account created! Signing you in...');
    const identifier = payload.email || payload.phone;
    setSignedInState(payload.type, identifier);
    if (payload.type === 'admin') {
      showPage('admin');
    } else {
      showPage('profile');
    }
  } catch (err) {
    toast(err.message, true);
  }
}

async function doPostJob() {
  const jobEmployer = document.getElementById('jobEmployer')?.value.trim();
  const defaultEmployer = currentUser?.role === 'employer' ? currentUser.profile?.company_name || currentUser.profile?.contact_name : 'SkillMatch Employer';
  const payload = {
    title: document.getElementById('jobTitle')?.value.trim(),
    employer: jobEmployer || defaultEmployer,
    category: document.getElementById('jobCategory')?.value,
    type: document.getElementById('jobType')?.value,
    salary: document.getElementById('jobSalary')?.value.trim(),
    city: document.getElementById('jobCity')?.value.trim(),
    description: document.getElementById('jobDescription')?.value.trim(),
    contact_number: document.getElementById('jobContact')?.value.trim(),
    contact_email: document.getElementById('jobContactEmail')?.value.trim(),
    employer_identifier: currentUser?.role === 'employer' ? currentUser.identifier : undefined,
  };
  if (!payload.title || !payload.employer || !payload.city || !payload.category || !payload.contact_number || !payload.contact_email) {
    toast('Please fill in the required job details', true);
    return;
  }
  try {
    await fetchJson('/api/post-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    toast('✅ Job posted!');
    showPage('find-jobs');
  } catch (err) {
    toast(err.message, true);
  }
}

async function loadEmployerApplications() {
  if (!currentUser || currentUser.role !== 'employer') return;
  const container = document.getElementById('employerApplications');
  if (!container) return;
  container.innerHTML = '<div class="app-card">Loading applications…</div>';
  try {
    const applications = await fetchJson('/api/employer/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: currentUser.identifier }),
    });
    renderEmployerApplications(applications);
  } catch (err) {
    container.innerHTML = `<div class="app-card"><strong>Error loading applications:</strong> ${err.message}</div>`;
  }
}

async function loadEmployerOffers() {
  if (!currentUser || currentUser.role !== 'employer') return;
  const container = document.getElementById('offerList');
  if (!container) return;
  container.innerHTML = '<div class="app-card">Loading offers…</div>';
  try {
    const offers = await fetchJson('/api/employer/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: currentUser.identifier }),
    });
    renderEmployerOffers(offers);
  } catch (err) {
    container.innerHTML = `<div class="app-card"><strong>Error loading offers:</strong> ${err.message}</div>`;
  }
}

async function loadWorkerApplications() {
  if (!currentUser || currentUser.role !== 'worker') return;
  const container = document.getElementById('workerApplications');
  if (!container) return;
  container.innerHTML = '<div class="app-card">Loading your applications…</div>';
  try {
    const applications = await fetchJson('/api/worker/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: currentUser.identifier }),
    });
    renderWorkerApplications(applications);
  } catch (err) {
    container.innerHTML = `<div class="app-card"><strong>Error loading applications:</strong> ${err.message}</div>`;
  }
}

async function loadWorkerOffers() {
  if (!currentUser || currentUser.role !== 'worker') return;
  const container = document.getElementById('offerList');
  if (!container) return;
  container.innerHTML = '<div class="app-card">Loading offers…</div>';
  try {
    const offers = await fetchJson('/api/worker/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: currentUser.identifier }),
    });
    renderWorkerOffers(offers);
  } catch (err) {
    container.innerHTML = `<div class="app-card"><strong>Error loading offers:</strong> ${err.message}</div>`;
  }
}

function renderEmployerApplications(apps) {
  const container = document.getElementById('employerApplications');
  if (!container) return;
  if (!apps || apps.length === 0) {
    container.innerHTML = '<div class="app-card"><strong>No applications yet.</strong><div class="app-card-meta">Worker applications will appear here when someone applies.</div></div>';
    return;
  }
  container.innerHTML = apps.map((app) => {
    const statusLabel = app.status
      ? `<span class="badge ${app.status === 'accepted' ? 'badge-green' : app.status === 'rejected' ? 'badge-amber' : 'badge-amber'}">${app.status.charAt(0).toUpperCase() + app.status.slice(1)}</span>`
      : '<span class="badge badge-gray">Pending</span>';
    const statusUpdated = app.status_updated_at
      ? `<div style="margin-top:8px;color:var(--text-mid);font-size:0.88rem">Updated: ${new Date(app.status_updated_at).toLocaleDateString()}</div>`
      : '';
    const statusMessage = app.status_message ? `<div class="app-card-meta"><strong>Message:</strong> ${app.status_message}</div>` : '';
    return `
      <div class="app-card">
        <div class="app-card-header">
          <div class="app-card-title">${app.worker_name} applied for "${app.job_title}"</div>
          <div style="font-size:0.88rem;color:var(--text-mid)">${new Date(app.created_at).toLocaleDateString()}</div>
        </div>
        <div class="app-card-meta">
          <strong>Worker role:</strong> ${app.worker_role || 'N/A'} · <strong>City:</strong> ${app.worker_city || 'N/A'} · <strong>Contact:</strong> ${app.worker_phone || 'N/A'} / ${app.worker_email || 'N/A'}
        </div>
        <div class="app-card-meta" style="margin-top:8px"><strong>Status:</strong> ${statusLabel}</div>
        ${statusMessage}
        ${statusUpdated}
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn btn-primary btn-sm" onclick="updateApplicationStatus(${app.application_id}, 'accepted')">Accept</button>
          <button class="btn btn-outline btn-sm" onclick="updateApplicationStatus(${app.application_id}, 'rejected')">Reject</button>
          <button class="btn btn-outline btn-sm" onclick="deleteApplication(${app.application_id})">Delete</button>
        </div>
      </div>`;
  }).join('');
}

function renderWorkerApplications(apps) {
  const container = document.getElementById('workerApplications');
  if (!container) return;
  if (!apps || apps.length === 0) {
    container.innerHTML = '<div class="app-card"><strong>No applications found.</strong><div class="app-card-meta">Your applications will appear here after you apply.</div></div>';
    return;
  }
  container.innerHTML = apps.map((app) => {
    const statusLabel = app.status
      ? `<span class="badge ${app.status === 'accepted' ? 'badge-green' : app.status === 'rejected' ? 'badge-amber' : 'badge-gray'}">${app.status.charAt(0).toUpperCase() + app.status.slice(1)}</span>`
      : '<span class="badge badge-gray">Pending</span>';
    const statusUpdated = app.status_updated_at
      ? `<div style="margin-top:8px;color:var(--text-mid);font-size:0.88rem">Updated: ${new Date(app.status_updated_at).toLocaleDateString()}</div>`
      : '';
    const statusMessage = app.status_message ? `<div class="app-card-meta"><strong>Employer note:</strong> ${app.status_message}</div>` : '';
    return `
      <div class="app-card">
        <div class="app-card-header">
          <div class="app-card-title">${app.job_title}</div>
          <div style="font-size:0.88rem;color:var(--text-mid)">${app.employer_name} · ${app.job_city || 'N/A'}</div>
        </div>
        <div class="app-card-meta" style="margin-top:8px"><strong>Status:</strong> ${statusLabel}</div>
        ${statusMessage}
        ${statusUpdated}
        <div class="app-card-meta" style="margin-top:8px"><strong>Applied:</strong> ${new Date(app.created_at).toLocaleDateString()}</div>
        <div style="margin-top:12px"><button class="btn btn-outline btn-sm" onclick="deleteApplication(${app.application_id})">Delete Application</button></div>
      </div>`;
  }).join('');
}

function showProfileTab(tab) {
  const details = document.getElementById('profileDetailsSection');
  const employerApps = document.getElementById('profileApplicationsSection');
  const workerApps = document.getElementById('profileWorkerApplicationsSection');
  const offers = document.getElementById('profileOffersSection');
  const detailsTab = document.getElementById('profileTabDetails');
  const appsTab = document.getElementById('profileTabApplications');
  const offersTab = document.getElementById('profileTabOffers');

  if (details) details.style.display = 'none';
  if (employerApps) employerApps.style.display = 'none';
  if (workerApps) workerApps.style.display = 'none';
  if (offers) offers.style.display = 'none';
  if (detailsTab) detailsTab.classList.remove('active');
  if (appsTab) appsTab.classList.remove('active');
  if (offersTab) offersTab.classList.remove('active');

  if (tab === 'applications') {
    if (currentUser.role === 'employer') {
      if (employerApps) employerApps.style.display = 'block';
      loadEmployerApplications();
    } else if (currentUser.role === 'worker') {
      if (workerApps) workerApps.style.display = 'block';
      loadWorkerApplications();
    }
    if (appsTab) appsTab.classList.add('active');
  } else if (tab === 'offers') {
    if (offers) offers.style.display = 'block';
    if (currentUser.role === 'employer') {
      loadEmployerOffers();
    } else if (currentUser.role === 'worker') {
      loadWorkerOffers();
    }
    if (offersTab) offersTab.classList.add('active');
  } else {
    if (details) details.style.display = 'block';
    if (detailsTab) detailsTab.classList.add('active');
  }
}

function renderEmployerActivity(apps, offers) {
  const container = document.getElementById('employerApplications');
  if (!container) return;
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-weight:700;font-size:1.05rem">Applications and Offers</div>
      <button class="btn btn-primary btn-sm" onclick="loadEmployerActivity()">Refresh</button>
    </div>
  `;
  if ((!apps || apps.length === 0) && (!offers || offers.length === 0)) {
    container.innerHTML += '<div class="app-card"><strong>No activity yet.</strong><div class="app-card-meta">Applications and employer offers will appear here.</div></div>';
    return;
  }
  if (apps && apps.length) {
    container.innerHTML += '<div style="margin-bottom:20px"><h3 style="margin:0 0 10px;font-size:1rem">Applications Received</h3>' + apps
      .map((app) => {
        const statusLabel = app.status
          ? `<span class="badge ${app.status === 'accepted' ? 'badge-green' : app.status === 'rejected' ? 'badge-amber' : 'badge-amber'}">${app.status.charAt(0).toUpperCase() + app.status.slice(1)}</span>`
          : '<span class="badge badge-gray">Pending</span>';
        const statusUpdated = app.status_updated_at
          ? `<div style="margin-top:8px;color:var(--text-mid);font-size:0.88rem">Updated: ${new Date(app.status_updated_at).toLocaleDateString()}</div>`
          : '';
        const statusMessage = app.status_message ? `<div class="app-card-meta"><strong>Message:</strong> ${app.status_message}</div>` : '';
        const actionButtons = `
          <div style="display:flex;gap:10px;margin-top:12px">
            <button class="btn btn-primary btn-sm" onclick="updateApplicationStatus(${app.application_id}, 'accepted')">Accept</button>
            <button class="btn btn-outline btn-sm" onclick="updateApplicationStatus(${app.application_id}, 'rejected')">Reject</button>
            <button class="btn btn-outline btn-sm" onclick="deleteApplication(${app.application_id})">Delete</button>
          </div>`;
        return `
          <div class="app-card">
            <div class="app-card-header">
              <div class="app-card-title">${app.worker_name} applied for "${app.job_title}"</div>
              <div style="font-size:0.88rem;color:var(--text-mid)">${new Date(app.created_at).toLocaleDateString()}</div>
            </div>
            <div class="app-card-meta">
              <strong>Worker role:</strong> ${app.worker_role || 'N/A'} · <strong>City:</strong> ${app.worker_city || 'N/A'} · <strong>Contact:</strong> ${app.worker_phone || 'N/A'} / ${app.worker_email || 'N/A'}
            </div>
            <div class="app-card-meta" style="margin-top:8px"><strong>Status:</strong> ${statusLabel}</div>
            ${statusMessage}
            ${statusUpdated}
            ${actionButtons}
          </div>`;
      })
      .join('') + '</div>';
  }
  if (offers && offers.length) {
    container.innerHTML += '<div><h3 style="margin:0 0 10px;font-size:1rem">Offers Sent to Workers</h3>' + offers
      .map((offer) => {
        const statusLabel = offer.status
          ? `<span class="badge ${offer.status === 'accepted' ? 'badge-green' : offer.status === 'rejected' ? 'badge-amber' : 'badge-gray'}">${offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}</span>`
          : '<span class="badge badge-gray">Offered</span>';
        const statusUpdated = offer.status_updated_at
          ? `<div style="margin-top:8px;color:var(--text-mid);font-size:0.88rem">Updated: ${new Date(offer.status_updated_at).toLocaleDateString()}</div>`
          : '';
        const actionButtons = `
          <div style="display:flex;gap:10px;margin-top:12px">
            <button class="btn btn-primary btn-sm" onclick="updateOfferStatus(${offer.offer_id}, 'pending')">Reset</button>
            <button class="btn btn-primary btn-sm" onclick="updateOfferStatus(${offer.offer_id}, 'accepted')">Mark Accepted</button>
            <button class="btn btn-outline btn-sm" onclick="updateOfferStatus(${offer.offer_id}, 'rejected')">Mark Rejected</button>
            <button class="btn btn-outline btn-sm" onclick="deleteOffer(${offer.offer_id})">Delete</button>
          </div>`;
        return `
          <div class="app-card">
            <div class="app-card-header">
              <div class="app-card-title">Offer to ${offer.worker_name}</div>
              <div style="font-size:0.88rem;color:var(--text-mid)">${new Date(offer.created_at).toLocaleDateString()}</div>
            </div>
            <div class="app-card-meta">
              <strong>Worker role:</strong> ${offer.worker_role || 'N/A'} · <strong>City:</strong> ${offer.worker_city || 'N/A'} · <strong>Contact:</strong> ${offer.worker_phone || 'N/A'} / ${offer.worker_email || 'N/A'}
            </div>
            <div class="app-card-meta" style="margin-top:8px"><strong>Status:</strong> ${statusLabel}</div>
            ${offer.message ? `<div class="app-card-meta"><strong>Message:</strong> ${offer.message}</div>` : ''}
            ${statusUpdated}
            ${actionButtons}
          </div>`;
      })
      .join('') + '</div>';
  }
}

function renderEmployerOffers(offers) {
  const container = document.getElementById('offerList');
  if (!container) return;
  if (!offers || offers.length === 0) {
    container.innerHTML = '<div class="app-card"><strong>No offers sent yet.</strong><div class="app-card-meta">Employer offers will appear here once you contact a worker.</div></div>';
    return;
  }
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-weight:700;font-size:1.05rem">Offers Sent</div>
      <button class="btn btn-primary btn-sm" onclick="loadEmployerOffers()">Refresh</button>
    </div>
  ` + offers
    .map((offer) => {
      const statusLabel = offer.status
        ? `<span class="badge ${offer.status === 'accepted' ? 'badge-green' : offer.status === 'rejected' ? 'badge-amber' : 'badge-gray'}">${offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}</span>`
        : '<span class="badge badge-gray">Offered</span>';
      const statusUpdated = offer.status_updated_at
        ? `<div style="margin-top:8px;color:var(--text-mid);font-size:0.88rem">Updated: ${new Date(offer.status_updated_at).toLocaleDateString()}</div>`
        : '';
      return `
      <div class="app-card">
        <div class="app-card-header">
          <div class="app-card-title">Offer to ${offer.worker_name}</div>
          <div style="font-size:0.88rem;color:var(--text-mid)">${new Date(offer.created_at).toLocaleDateString()}</div>
        </div>
        <div class="app-card-meta">
          <strong>Worker role:</strong> ${offer.worker_role || 'N/A'} · <strong>City:</strong> ${offer.worker_city || 'N/A'} · <strong>Contact:</strong> ${offer.worker_phone || 'N/A'} / ${offer.worker_email || 'N/A'}
        </div>
        <div class="app-card-meta" style="margin-top:8px"><strong>Status:</strong> ${statusLabel}</div>
        ${offer.message ? `<div class="app-card-meta"><strong>Message:</strong> ${offer.message}</div>` : ''}
        ${statusUpdated}
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn btn-primary btn-sm" onclick="updateOfferStatus(${offer.offer_id}, 'accepted')">Accept</button>
          <button class="btn btn-outline btn-sm" onclick="updateOfferStatus(${offer.offer_id}, 'rejected')">Reject</button>
          <button class="btn btn-outline btn-sm" onclick="deleteOffer(${offer.offer_id})">Delete</button>
        </div>
      </div>`;
    })
    .join('');
}

function renderWorkerOffers(offers) {
  const container = document.getElementById('offerList');
  if (!container) return;
  if (!offers || offers.length === 0) {
    container.innerHTML = '<div class="app-card"><strong>No offers received yet.</strong><div class="app-card-meta">Offers sent by employers will appear here.</div></div>';
    return;
  }
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-weight:700;font-size:1.05rem">Offers Received</div>
      <button class="btn btn-primary btn-sm" onclick="loadWorkerOffers()">Refresh</button>
    </div>
  ` + offers
    .map((offer) => {
      const statusLabel = offer.status
        ? `<span class="badge ${offer.status === 'accepted' ? 'badge-green' : offer.status === 'rejected' ? 'badge-amber' : 'badge-gray'}">${offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}</span>`
        : '<span class="badge badge-gray">Offered</span>';
      const statusUpdated = offer.status_updated_at
        ? `<div style="margin-top:8px;color:var(--text-mid);font-size:0.88rem">Updated: ${new Date(offer.status_updated_at).toLocaleDateString()}</div>`
        : '';
      return `
      <div class="app-card">
        <div class="app-card-header">
          <div class="app-card-title">Offer from ${offer.employer_name}</div>
          <div style="font-size:0.88rem;color:var(--text-mid)">${new Date(offer.created_at).toLocaleDateString()}</div>
        </div>
        <div class="app-card-meta">
          <strong>Employer:</strong> ${offer.employer_name} · ${offer.employer_city || 'N/A'}
        </div>
        <div class="app-card-meta">
          <strong>Type:</strong> ${offer.employer_type || 'N/A'}
        </div>
        <div class="app-card-meta" style="margin-top:8px"><strong>Status:</strong> ${statusLabel}</div>
        <div class="app-card-meta" style="margin-top:8px"><strong>About Employer:</strong> ${offer.employer_description || 'No additional details provided.'}</div>
        ${offer.message ? `<div class="app-card-meta"><strong>Message:</strong> ${offer.message}</div>` : ''}
        ${statusUpdated}
        <div style="display:flex;gap:10px;margin-top:12px">
          <button class="btn btn-primary btn-sm" onclick="updateOfferStatus(${offer.offer_id}, 'accepted')">Accept</button>
          <button class="btn btn-outline btn-sm" onclick="updateOfferStatus(${offer.offer_id}, 'rejected')">Reject</button>
          <button class="btn btn-outline btn-sm" onclick="deleteOffer(${offer.offer_id})">Delete</button>
        </div>
      </div>`;
    })
    .join('');
}

async function loadWorkerActivity() {
  if (!currentUser || currentUser.role !== 'worker') return;
  const container = document.getElementById('workerApplications');
  if (!container) return;
  container.innerHTML = '<div class="app-card">Loading your applications and offers…</div>';
  try {
    const [applications, offers] = await Promise.all([
      fetchJson('/api/worker/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: currentUser.identifier }),
      }),
      fetchJson('/api/worker/offers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: currentUser.identifier }),
      }),
    ]);
    renderWorkerActivity(applications, offers);
  } catch (err) {
    container.innerHTML = `<div class="app-card"><strong>Error loading your activity:</strong> ${err.message}</div>`;
  }
}

function renderWorkerActivity(apps, offers) {
  const container = document.getElementById('workerApplications');
  if (!container) return;
  container.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <div style="font-weight:700;font-size:1.05rem">My Applications and Offers</div>
      <button class="btn btn-primary btn-sm" onclick="loadWorkerActivity()">Refresh</button>
    </div>
  `;
  if ((!apps || apps.length === 0) && (!offers || offers.length === 0)) {
    container.innerHTML += '<div class="app-card"><strong>No activity found.</strong><div class="app-card-meta">Your job applications and incoming offers will appear here.</div></div>';
    return;
  }
  if (apps && apps.length) {
    container.innerHTML += '<div style="margin-bottom:20px"><h3 style="margin:0 0 10px;font-size:1rem">My Applications</h3>' + apps
      .map((app) => {
        const statusLabel = app.status
          ? `<span class="badge ${app.status === 'accepted' ? 'badge-green' : app.status === 'rejected' ? 'badge-amber' : 'badge-amber'}">${app.status.charAt(0).toUpperCase() + app.status.slice(1)}</span>`
          : '<span class="badge badge-gray">Pending</span>';
        const statusUpdated = app.status_updated_at
          ? `<div style="margin-top:8px;color:var(--text-mid);font-size:0.88rem">Updated: ${new Date(app.status_updated_at).toLocaleDateString()}</div>`
          : '';
        const statusMessage = app.status_message ? `<div class="app-card-meta"><strong>Employer note:</strong> ${app.status_message}</div>` : '';
        return `
          <div class="app-card">
            <div class="app-card-header">
              <div class="app-card-title">${app.job_title}</div>
              <div style="font-size:0.88rem;color:var(--text-mid)">${app.employer_name} · ${app.job_city || 'N/A'}</div>
            </div>
            <div class="app-card-meta" style="margin-top:8px"><strong>Status:</strong> ${statusLabel}</div>
            ${statusMessage}
            ${statusUpdated}
            <div class="app-card-meta" style="margin-top:8px"><strong>Applied:</strong> ${new Date(app.created_at).toLocaleDateString()}</div>
            <div style="margin-top:12px"><button class="btn btn-outline btn-sm" onclick="deleteApplication(${app.application_id})">Delete Application</button></div>
          </div>`;
      })
      .join('') + '</div>';
  }
  if (offers && offers.length) {
    container.innerHTML += '<div><h3 style="margin:0 0 10px;font-size:1rem">Offers Received</h3>' + offers
      .map((offer) => {
        const statusLabel = offer.status
          ? `<span class="badge ${offer.status === 'accepted' ? 'badge-green' : offer.status === 'rejected' ? 'badge-amber' : 'badge-gray'}">${offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}</span>`
          : '<span class="badge badge-gray">Offered</span>';
        const statusUpdated = offer.status_updated_at
          ? `<div style="margin-top:8px;color:var(--text-mid);font-size:0.88rem">Updated: ${new Date(offer.status_updated_at).toLocaleDateString()}</div>`
          : '';
        return `
          <div class="app-card">
            <div class="app-card-header">
              <div class="app-card-title">Offer from ${offer.employer_name}</div>
              <div style="font-size:0.88rem;color:var(--text-mid)">${new Date(offer.created_at).toLocaleDateString()}</div>
            </div>
            <div class="app-card-meta">
              <strong>Employer:</strong> ${offer.employer_name} · ${offer.employer_city || 'N/A'}
            </div>
            <div class="app-card-meta" style="margin-top:8px"><strong>Status:</strong> ${statusLabel}</div>
            ${offer.message ? `<div class="app-card-meta"><strong>Message:</strong> ${offer.message}</div>` : ''}
            ${statusUpdated}
            <div style="display:flex;gap:10px;margin-top:12px">
              <button class="btn btn-primary btn-sm" onclick="updateOfferStatus(${offer.offer_id}, 'accepted')">Accept</button>
              <button class="btn btn-outline btn-sm" onclick="updateOfferStatus(${offer.offer_id}, 'rejected')">Reject</button>
              <button class="btn btn-outline btn-sm" onclick="updateOfferStatus(${offer.offer_id}, 'pending')">Reset</button>
              <button class="btn btn-outline btn-sm" onclick="deleteOffer(${offer.offer_id})">Delete</button>
            </div>
          </div>`;
      })
      .join('') + '</div>';
  }
}

async function deleteApplication(applicationId) {
  if (!currentUser) {
    toast('Please sign in before deleting an application.', true);
    return;
  }
  if (!confirm('Delete this application permanently?')) return;
  try {
    await fetchJson('/api/application/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: currentUser.identifier, application_id: applicationId }),
    });
    toast('✅ Application deleted');
    if (currentUser.role === 'employer') {
      loadEmployerApplications();
    } else if (currentUser.role === 'worker') {
      loadWorkerApplications();
    }
  } catch (err) {
    toast(err.message, true);
  }
}

async function updateOfferStatus(offerId, status) {
  if (!currentUser) {
    toast('Please sign in before updating an offer.', true);
    return;
  }
  try {
    await fetchJson('/api/offer/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: currentUser.identifier, offer_id: offerId, status }),
    });
    toast(`✅ Offer status set to ${status}`);
    if (currentUser.role === 'employer') {
      loadEmployerOffers();
    } else if (currentUser.role === 'worker') {
      loadWorkerOffers();
    }
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteOffer(offerId) {
  if (!currentUser) {
    toast('Please sign in before deleting an offer.', true);
    return;
  }
  if (!confirm('Delete this offer permanently?')) return;
  try {
    await fetchJson('/api/offer/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: currentUser.identifier, offer_id: offerId }),
    });
    toast('✅ Offer deleted');
    if (currentUser.role === 'employer') {
      loadEmployerOffers();
    } else if (currentUser.role === 'worker') {
      loadWorkerOffers();
    }
  } catch (err) {
    toast(err.message, true);
  }
}

async function updateApplicationStatus(applicationId, status) {
  if (!currentUser || currentUser.role !== 'employer') {
    toast('Only employers can update application status', true);
    return;
  }
  try {
    await fetchJson('/api/application/update-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: currentUser.identifier, application_id: applicationId, status }),
    });
    toast(`✅ Application ${status}`);
    loadEmployerApplications();
  } catch (err) {
    toast(err.message, true);
  }
}

async function doContact() {
  const payload = {
    name: document.getElementById('contactName')?.value.trim(),
    contact: document.getElementById('contactInfo')?.value.trim(),
    subject: document.getElementById('contactSubject')?.value,
    message: document.getElementById('contactMessage')?.value.trim(),
  };
  if (!payload.name || !payload.contact || !payload.message) {
    toast('Please complete the contact form', true);
    return;
  }
  try {
    await fetchJson('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    toast('✅ Message sent! We will respond shortly.');
  } catch (err) {
    toast(err.message, true);
  }
}

function doReset() {
  const password = document.getElementById('forgotPassword')?.value;
  const confirm = document.getElementById('forgotConfirmPassword')?.value;
  if (!password || password !== confirm) {
    toast('Passwords do not match', true);
    return;
  }
  toast('✅ Password reset successfully!');
  showPage('home');
}

function heroSearch(val) {
  if (val.length > 2) {
    showPage('find-workers');
    document.getElementById('workerSearch').value = val;
    loadWorkers(val);
  }
}

function quickSearch(val) {
  showPage('find-workers');
  document.getElementById('workerSearch').value = val;
  loadWorkers(val);
}

function filterWorkers(cat) {
  showPage('find-workers');
  setWorkerFilter(null, cat);
}

function renderWorkerCard(w) {
  return `<div class="worker-card">
    <div class="worker-top">
      <div class="worker-avatar">${w.icon || '👤'}</div>
      <div style="flex:1">
        <div class="worker-name">${w.name}</div>
        <div class="worker-role">${w.role}</div>
      </div>
      ${w.verified ? '<span class="badge badge-green">✓ Verified</span>' : '<span class="badge badge-gray">Unverified</span>'}
    </div>
    <div class="worker-meta">
      <span class="meta-item">📍 ${w.city}</span>
      <span class="meta-item">${w.available ? '<span class="badge badge-green">● Available</span>' : '<span class="badge badge-amber">● Busy</span>'}</span>
    </div>
    <div class="worker-skills">${(w.skills || []).map((s) => `<span class="skill-tag">${s}</span>`).join('')}</div>
    <div class="worker-footer">
      <div class="worker-exp">Exp: <strong>${w.experience_years || 'N/A'}</strong></div>
      <div style="display:flex;align-items:center;gap:10px">
        <div style="font-weight:700;font-size:0.9rem;color:var(--green)">${w.salary_expected || '₹0/mo'}</div>
        <button class="btn btn-primary btn-sm" onclick="contactWorker(${w.id},'${w.name.replace(/'/g,"\\'")}','${(w.role||'').replace(/'/g,"\\'")}','${(w.city||'').replace(/'/g,"\\'")}')">Contact</button>
      </div>
    </div>
  </div>`;
}

function renderJobCard(j) {
  const icon = j.icon || (j.category === 'Domestic' ? '🍳' : j.category === 'Trades' ? '⚡' : j.category === 'Transport' ? '🚛' : '💼');
  return `<div class="job-card">
    <div class="job-icon">${icon}</div>
    <div class="job-info">
      <div class="job-title">${j.title}</div>
      <div class="job-meta">
        <span>🏢 ${j.employer}</span>
        <span>📍 ${j.city}</span>
        <span>🕐 ${new Date(j.posted_at).toLocaleDateString()}</span>
      </div>
    </div>
    <div class="job-right">
      <div class="job-salary">${j.salary || 'N/A'}</div>
      <div class="job-type"><span class="badge badge-blue">${j.type || 'Open'}</span></div>
      <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="applyJob(${j.id})">Apply Now</button>
    </div>
  </div>`;
}

function renderWorkers() {
  const list = document.getElementById('workerList');
  const count = document.getElementById('workerCount');
  if (list) list.innerHTML = workers.map(renderWorkerCard).join('');
  if (count) count.textContent = workers.length;
}

function renderFeaturedWorkers() {
  const featured = document.getElementById('featuredWorkers');
  if (featured) featured.innerHTML = workers.slice(0, 3).map(renderWorkerCard).join('');
}

function renderJobs() {
  const list = document.getElementById('jobList');
  const count = document.getElementById('jobCount');
  if (list) list.innerHTML = jobs.map(renderJobCard).join('');
  if (count) count.textContent = jobs.length;
}

function renderRecentJobs() {
  const recent = document.getElementById('recentJobs');
  if (recent) recent.innerHTML = jobs.slice(0, 4).map(renderJobCard).join('');
}

function contactWorker(workerId, workerName, workerRole, workerCity) {
  if (!currentUser) {
    toast('Please sign in as an employer to contact this worker.', true);
    openModal();
    return;
  }
  if (currentUser.role !== 'employer') {
    toast('Only registered employers can contact workers directly.', true);
    return;
  }
  // Show contact-worker modal
  let modal = document.getElementById('contactWorkerModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'contactWorkerModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    modal.innerHTML = `
      <div style="background:var(--white,#fff);border-radius:16px;padding:32px;max-width:480px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.18)">
        <h2 style="margin:0 0 4px;font-size:1.3rem">📨 Express Hiring Interest</h2>
        <p id="cwWorkerInfo" style="margin:0 0 18px;color:var(--text-light,#888);font-size:0.92rem"></p>
        <label style="font-weight:600;font-size:0.9rem">Message to Worker <span style="font-weight:400;color:#888">(optional)</span></label>
        <textarea id="cwMessage" rows="4" placeholder="Hi! We are interested in hiring you for... Please reach out to us." style="width:100%;margin-top:6px;padding:10px 12px;border:1.5px solid #ddd;border-radius:8px;font-size:0.95rem;resize:vertical;box-sizing:border-box"></textarea>
        <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">
          <button onclick="document.getElementById('contactWorkerModal').remove()" style="padding:10px 20px;border:1.5px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;font-size:0.95rem">Cancel</button>
          <button id="cwSendBtn" style="padding:10px 24px;background:var(--accent,#e85d26);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.95rem" onclick="doContactWorker()">Send Email ✉️</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  }
  modal.dataset.workerId = workerId;
  document.getElementById('cwWorkerInfo').textContent = `${workerName} · ${workerRole} · ${workerCity}`;
  document.getElementById('cwMessage').value = '';
  modal.style.display = 'flex';
}

async function doContactWorker() {
  const modal = document.getElementById('contactWorkerModal');
  if (!modal) return;
  const workerId = modal.dataset.workerId;
  const message = document.getElementById('cwMessage')?.value.trim();
  const btn = document.getElementById('cwSendBtn');
  btn.disabled = true;
  btn.textContent = 'Sending…';
  try {
    const data = await fetchJson('/api/contact-worker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: workerId, employer_identifier: currentUser.identifier, message }),
    });
    modal.remove();
    toast(`✅ ${data.message}`);
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Send Email ✉️';
    toast(err.message, true);
  }
}

function filterWorkerList(val) {
  loadWorkers(val);
}

function setWorkerFilter(el, cat) {
  currentWorkerFilter = cat;
  if (el) {
    document.querySelectorAll('#categoryFilters .filter-chip').forEach((c) => c.classList.remove('active'));
    el.classList.add('active');
  }
  loadWorkers(document.getElementById('workerSearch')?.value || '');
}

function sortWorkers(val) {
  toast('Sorted!');
}

function filterJobList(val) {
  loadJobs(val);
}

function setJobFilter(el, cat) {
  currentJobFilter = cat;
  document.querySelectorAll('#page-find-jobs .filter-chip').forEach((c) => c.classList.remove('active'));
  el.classList.add('active');
  loadJobs(document.getElementById('jobSearch')?.value || '');
}

function renderNCO() {
  const cont = document.getElementById('ncoContent');
  if (!cont) return;
  cont.innerHTML = ncoGroups
    .map(
      (g, i) => `
      <div class="nco-major">
        <div class="nco-major-header" onclick="toggleNCO(${i})">
          <div class="nco-num" style="background:${g.color}">${g.num}</div>
          <div class="nco-title">${g.name}</div>
          <div class="nco-toggle" id="toggle-${i}">▼</div>
        </div>
        <div class="nco-subs" id="nco-subs-${i}">
          ${g.subs
            .map(
              (s) => `
            <div class="nco-sub" onclick="filterWorkers('${s}')">
              <div class="nco-sub-dot"></div>
              <div class="nco-sub-name">${s}</div>
              <div class="nco-sub-count">${Math.floor(Math.random() * 200 + 20)} workers</div>
              <button class="btn btn-outline btn-sm" onclick="event.stopPropagation();filterSearch('${s}')">Find →</button>
            </div>`
            )
            .join('')}
        </div>
      </div>`
    )
    .join('');
}

function toggleNCO(i) {
  const subs = document.getElementById('nco-subs-' + i);
  const tog = document.getElementById('toggle-' + i);
  if (!subs || !tog) return;
  subs.classList.toggle('open');
  tog.classList.toggle('open');
}

function filterSearch(role) {
  showPage('find-workers');
  document.getElementById('workerSearch').value = role;
  loadWorkers(role);
}

function setRegTab(el, type) {
  document.querySelectorAll('.form-tab').forEach((t) => t.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('regWorker').style.display = type === 'worker' ? 'block' : 'none';
  document.getElementById('regEmployer').style.display = type === 'employer' ? 'block' : 'none';
  document.getElementById('regAdmin').style.display = type === 'admin' ? 'block' : 'none';
}

async function renderAdminDashboard() {
  try {
    const [workersData, employersData, jobsData] = await Promise.all([
      fetchJson('/api/admin/workers'),
      fetchJson('/api/admin/employers'),
      fetchJson('/api/admin/jobs'),
    ]);
    const workerContainer = document.getElementById('adminWorkerList');
    const employerContainer = document.getElementById('adminEmployerList');
    if (workerContainer) {
      workerContainer.innerHTML = workersData
        .map(
          (w) => `
          <div class="worker-card admin-card">
            <div class="worker-top">
              <div class="worker-avatar">${w.icon || '👤'}</div>
              <div style="flex:1">
                <div class="worker-name">${w.name || `${w.first_name} ${w.last_name}`}</div>
                <div class="worker-role">${w.role || w.category || 'Worker'}</div>
              </div>
              <button class="btn btn-outline btn-sm" onclick="deleteAdminWorker(${w.id})">Delete</button>
            </div>
            <div class="worker-meta">
              <span class="meta-item">📍 ${w.city || 'N/A'}</span>
              <span class="meta-item">${w.email || ''}</span>
            </div>
            <div class="worker-skills">${(w.skills || []).map((s) => `<span class="skill-tag">${s}</span>`).join('')}</div>
          </div>`
        )
        .join('');
    }
    if (employerContainer) {
      employerContainer.innerHTML = employersData
        .map(
          (e) => `
          <div class="job-card admin-card">
            <div class="job-icon">🏢</div>
            <div class="job-info">
              <div class="job-title">${e.company_name || e.contact_name}</div>
              <div class="job-meta">
                <span>👤 ${e.contact_name}</span>
                <span>📍 ${e.city || 'N/A'}</span>
                <span>📱 ${e.phone || ''}</span>
              </div>
            </div>
            <div class="job-right">
              <button class="btn btn-outline btn-sm" onclick="deleteAdminEmployer(${e.id})">Delete</button>
            </div>
          </div>`
        )
        .join('');
    }
    const jobSection = document.getElementById('adminJobList');
    if (jobSection) {
      jobSection.innerHTML = jobsData
        .map(
          (j) => `
          <div class="job-card admin-card">
            <div class="job-icon">💼</div>
            <div class="job-info">
              <div class="job-title">${j.title}</div>
              <div class="job-meta">
                <span>🏢 ${j.employer}</span>
                <span>📍 ${j.city || 'N/A'}</span>
                <span>✉️ ${j.contact_email || 'No email'}</span>
              </div>
            </div>
            <div class="job-right">
              <button class="btn btn-outline btn-sm" onclick="deleteAdminJob(${j.id})">Delete</button>
            </div>
          </div>`
        )
        .join('');
    }
    toast('Admin dashboard refreshed');
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteAdminWorker(id) {
  if (!confirm('Delete this worker permanently?')) return;
  try {
    await fetchJson('/api/admin/delete-worker', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    toast('Worker deleted successfully');
    renderAdminDashboard();
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteAdminEmployer(id) {
  if (!confirm('Delete this employer permanently?')) return;
  try {
    await fetchJson('/api/admin/delete-employer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    toast('Employer deleted successfully');
    renderAdminDashboard();
  } catch (err) {
    toast(err.message, true);
  }
}

async function deleteAdminJob(id) {
  if (!confirm('Delete this job permanently?')) return;
  try {
    await fetchJson('/api/admin/delete-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    toast('Job deleted successfully');
    renderAdminDashboard();
  } catch (err) {
    toast(err.message, true);
  }
}

async function renderProfile() {
  if (!currentUser) {
    toast('Please sign in to view your profile', true);
    return;
  }
  try {
    const data = await fetchJson('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: currentUser.role, identifier: currentUser.identifier }),
    });
    document.getElementById('profileName').textContent = data.name || `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'My Profile';
    document.getElementById('profileRole').textContent = data.role ? data.role.charAt(0).toUpperCase() + data.role.slice(1) : currentUser.role;
    document.getElementById('profileEmail').textContent = data.email || '—';
    document.getElementById('profilePhone').textContent = data.phone || '—';
    document.getElementById('profileLocation').textContent = data.city ? `${data.city}${data.state ? ', ' + data.state : ''}` : '—';
    document.getElementById('profileJoined').textContent = data.created_at ? new Date(data.created_at).toLocaleDateString() : '—';
    const extra = document.getElementById('profileExtra');
    const actions = document.getElementById('profileActions');
    let offers = [];
    if (currentUser.role === 'worker') {
      try {
        offers = await fetchJson('/api/worker/offers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: currentUser.identifier }),
        });
      } catch (err) {
        offers = [];
      }
    } else if (currentUser.role === 'employer') {
      try {
        offers = await fetchJson('/api/employer/offers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: currentUser.identifier }),
        });
      } catch (err) {
        offers = [];
      }
    }
    if (extra) {
      if (currentUser.role === 'worker') {
        extra.innerHTML = `<strong>Experience:</strong> ${data.experience_years || 'N/A'}<br><strong>Skills:</strong> ${(data.skills || []).join(', ') || 'N/A'}<br><strong>Offers received:</strong> ${offers.length}`;
      } else if (currentUser.role === 'employer') {
        extra.innerHTML = `<strong>Company:</strong> ${data.company_name || 'N/A'}<br><strong>Employer type:</strong> ${data.employer_type || 'N/A'}<br><strong>Offers sent:</strong> ${offers.length}`;
      } else if (currentUser.role === 'admin') {
        extra.innerHTML = `<strong>Administrator</strong>`;
      } else {
        extra.innerHTML = '';
      }
    }
    if (actions) {
      actions.innerHTML = '';
      if (currentUser.role === 'worker' || currentUser.role === 'employer') {
        actions.innerHTML = `<button class="btn btn-primary" onclick="showProfileTab('offers')">View Offers</button>`;
      }
    }
    const tabBar = document.getElementById('profileTabBar');
    const detailsSection = document.getElementById('profileDetailsSection');
    const employerAppSection = document.getElementById('profileApplicationsSection');
    const workerAppSection = document.getElementById('profileWorkerApplicationsSection');
    const offerSection = document.getElementById('profileOffersSection');
    if (tabBar) {
      tabBar.style.display = currentUser.role === 'employer' || currentUser.role === 'worker' ? 'flex' : 'none';
    }
    if (employerAppSection) {
      employerAppSection.style.display = 'none';
    }
    if (workerAppSection) {
      workerAppSection.style.display = 'none';
    }
    if (offerSection) {
      offerSection.style.display = 'none';
    }
    if (detailsSection) {
      detailsSection.style.display = 'block';
    }
    showProfileTab('details');
  } catch (err) {
    toast(err.message, true);
  }
}

function logout() {
  currentUser = null;
  document.getElementById('logoutBtn')?.style.setProperty('display', 'none');
  document.getElementById('profileBtn')?.style.setProperty('display', 'none');
  document.getElementById('adminDashboardBtn')?.style.setProperty('display', 'none');
  document.getElementById('signInBtn')?.style.setProperty('display', 'inline-flex');
  document.getElementById('registerBtn')?.style.setProperty('display', 'inline-flex');
  toast('✅ Logged out successfully');
  showPage('home');
}

async function applyJob(jobId) {
  if (!currentUser || currentUser.role !== 'worker') {
    toast('Please login as a worker to apply for this job', true);
    openModal();
    return;
  }
  // Fetch worker profile to preview what will be sent
  let workerData;
  try {
    workerData = await fetchJson('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'worker', identifier: currentUser.identifier }),
    });
  } catch (err) {
    toast(err.message, true);
    return;
  }
  // Find job details
  const job = jobs.find((j) => j.id === jobId);

  // Show confirmation modal
  let modal = document.getElementById('applyJobModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'applyJobModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
  }
  const skills = Array.isArray(workerData.skills) ? workerData.skills.join(', ') : workerData.skills || 'N/A';
  modal.innerHTML = `
    <div style="background:var(--white,#fff);border-radius:16px;padding:28px 32px;max-width:500px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.18)">
      <h2 style="margin:0 0 4px;font-size:1.25rem">🚀 Confirm Job Application</h2>
      <p style="margin:0 0 16px;color:var(--text-light,#888);font-size:0.9rem">The following details from your profile will be sent to the employer.</p>
      ${job ? `<div style="background:#f5f7fa;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:0.92rem"><strong>Applying for:</strong> ${job.title}<br><span style="color:#888">by ${job.employer} · ${job.city}</span></div>` : ''}
      <div style="background:#f0f9f4;border-radius:10px;padding:14px 16px;font-size:0.92rem;line-height:1.8">
        <div><strong>Name:</strong> ${workerData.name || ''}</div>
        <div><strong>Role:</strong> ${workerData.role || 'N/A'}</div>
        <div><strong>Location:</strong> ${workerData.city || 'N/A'}${workerData.state ? ', ' + workerData.state : ''}</div>
        <div><strong>Experience:</strong> ${workerData.experience_years != null ? workerData.experience_years + ' yrs' : 'N/A'}</div>
        <div><strong>Expected Salary:</strong> ${workerData.salary_expected || 'N/A'}</div>
        <div><strong>Skills:</strong> ${skills}</div>
        <div><strong>Phone:</strong> ${workerData.phone || 'N/A'}</div>
        <div><strong>Email:</strong> ${workerData.email || 'N/A'}</div>
      </div>
      <p style="font-size:0.82rem;color:#aaa;margin:10px 0 18px">This information will be emailed directly to the employer's contact address.</p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button onclick="document.getElementById('applyJobModal').remove()" style="padding:10px 20px;border:1.5px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;font-size:0.95rem">Cancel</button>
        <button id="applyConfirmBtn" style="padding:10px 24px;background:var(--green,#2d7d46);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.95rem" onclick="doApplyJob(${jobId})">Send Application ✉️</button>
      </div>
    </div>`;
  modal.style.display = 'flex';
}

async function doApplyJob(jobId) {
  const btn = document.getElementById('applyConfirmBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
  try {
    const data = await fetchJson('/api/apply-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId, identifier: currentUser.identifier }),
    });
    document.getElementById('applyJobModal')?.remove();
    toast(data.message || '✅ Application sent to employer!');
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = 'Send Application ✉️'; }
    toast(err.message, true);
  }
}

function forgotNext(step) {
  document.getElementById('forgotStep1').style.display = 'none';
  document.getElementById('forgotStep2').style.display = 'none';
  document.getElementById('forgotStep3').style.display = 'none';
  document.getElementById('forgotStep' + step).style.display = 'block';
  ['step1ind', 'step2ind', 'step3ind'].forEach((id, idx) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (idx + 1 < step) {
      el.style.background = 'var(--green)';
      el.style.color = '#fff';
    } else if (idx + 1 === step) {
      el.style.background = 'var(--accent)';
      el.style.color = '#fff';
    } else {
      el.style.background = 'var(--light-gray)';
      el.style.color = 'var(--text-light)';
    }
  });
}

window.addEventListener('DOMContentLoaded', initApp);
window.showPage = showPage;
window.openModal = openModal;
window.closeModal = closeModal;
window.setRole = setRole;
window.setMode = setMode;
window.doLogin = doLogin;
window.doRegister = doRegister;
window.doPostJob = doPostJob;
window.doContact = doContact;
window.doReset = doReset;
window.heroSearch = heroSearch;
window.quickSearch = quickSearch;
window.filterWorkers = filterWorkers;
window.filterWorkerList = filterWorkerList;
window.setWorkerFilter = setWorkerFilter;
window.sortWorkers = sortWorkers;
window.renderNCO = renderNCO;
window.toggleNCO = toggleNCO;
window.filterSearch = filterSearch;
window.setRegTab = setRegTab;
window.forgotNext = forgotNext;
window.applyJob = applyJob;
window.doApplyJob = doApplyJob;
window.contactWorker = contactWorker;
window.doContactWorker = doContactWorker;
window.showProfileTab = showProfileTab;
window.updateApplicationStatus = updateApplicationStatus;