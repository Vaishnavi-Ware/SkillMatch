const API_BASE = '';
let workers = [];
let jobs = [];
let ncoGroups = [];
let currentWorkerFilter = '';
let currentJobFilter = '';
let currentUser = null;
let viewedUser = null;

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

function showPage(id, updateHash = true) {
  let pageId = String(id || 'home').replace(/^#/, '') || 'home';
  document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach((a) => a.classList.remove('active'));
  let page = document.getElementById('page-' + pageId);
  if (!page) {
    pageId = 'home';
    page = document.getElementById('page-home');
  }
  if (page) page.classList.add('active');
  const navEl = document.getElementById('nav-' + pageId);
  if (navEl) navEl.classList.add('active');
  if (updateHash && location.hash !== `#${pageId}`) {
    history.replaceState(null, '', `#${pageId}`);
  }
  window.scrollTo(0, 0);
  if (pageId === 'find-workers') loadWorkers(document.getElementById('workerSearch')?.value || '');
  if (pageId === 'find-jobs') loadJobs(document.getElementById('jobSearch')?.value || '');
  if (pageId === 'nco') renderNCO();
  if (pageId === 'admin') renderAdminDashboard();
  if (pageId === 'profile') renderProfile();
  if (pageId === 'post-job') prefillJobPostForm();
  if (pageId === 'posts') loadPostsFeed();
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

async function loadCurrentUserProfile() {
  if (!currentUser?.identifier || !currentUser?.role) return;
  try {
    const profile = await fetchJson('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: currentUser.identifier, role: currentUser.role })
    });
    currentUser.profile = profile;
  } catch (err) {
    console.warn('Unable to load current user profile:', err);
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
    await loadCurrentUserProfile();
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
    await loadCurrentUserProfile();
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
  const container = document.getElementById('applicationsList');
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
  const container = document.getElementById('offersList');
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
  const container = document.getElementById('applicationsList');
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
  const container = document.getElementById('offersList');
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
          <button class="btn btn-primary btn-sm" onclick="updateApplicationStatus('${app.application_id}', 'accepted')">Accept</button>
          <button class="btn btn-outline btn-sm" onclick="updateApplicationStatus('${app.application_id}', 'rejected')">Reject</button>
          <button class="btn btn-outline btn-sm" onclick="deleteApplication('${app.application_id}')">Delete</button>
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
        <div style="margin-top:12px;display:flex;gap:8px">
          <button class="btn btn-outline btn-sm" onclick="editApplication('${app.application_id}')">Edit</button>
          <button class="btn btn-outline btn-sm" onclick="deleteApplication('${app.application_id}')">Delete</button>
        </div>
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
            <button class="btn btn-primary btn-sm" onclick="updateApplicationStatus('${app.application_id}', 'accepted')">Accept</button>
            <button class="btn btn-outline btn-sm" onclick="updateApplicationStatus('${app.application_id}', 'rejected')">Reject</button>
            <button class="btn btn-outline btn-sm" onclick="deleteApplication('${app.application_id}')">Delete</button>
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
            <button class="btn btn-primary btn-sm" onclick="updateOfferStatus('${offer.offer_id}', 'pending')">Reset</button>
            <button class="btn btn-primary btn-sm" onclick="updateOfferStatus('${offer.offer_id}', 'accepted')">Mark Accepted</button>
            <button class="btn btn-outline btn-sm" onclick="updateOfferStatus('${offer.offer_id}', 'rejected')">Mark Rejected</button>
            <button class="btn btn-outline btn-sm" onclick="deleteOffer('${offer.offer_id}')">Delete</button>
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
          <button class="btn btn-primary btn-sm" onclick="editOffer('${offer.offer_id}')">Edit</button>
          <button class="btn btn-outline btn-sm" onclick="deleteOffer('${offer.offer_id}')">Delete</button>
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
          <button class="btn btn-primary btn-sm" onclick="updateOfferStatus('${offer.offer_id}', 'accepted')">Accept</button>
          <button class="btn btn-outline btn-sm" onclick="updateOfferStatus('${offer.offer_id}', 'rejected')">Reject</button>
          <button class="btn btn-outline btn-sm" onclick="deleteOffer('${offer.offer_id}')">Delete</button>
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
            <div style="margin-top:12px"><button class="btn btn-outline btn-sm" onclick="deleteApplication('${app.application_id}')">Delete Application</button></div>
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
              <button class="btn btn-primary btn-sm" onclick="updateOfferStatus('${offer.offer_id}', 'accepted')">Accept</button>
              <button class="btn btn-outline btn-sm" onclick="updateOfferStatus('${offer.offer_id}', 'rejected')">Reject</button>
              <button class="btn btn-outline btn-sm" onclick="updateOfferStatus('${offer.offer_id}', 'pending')">Reset</button>
              <button class="btn btn-outline btn-sm" onclick="deleteOffer('${offer.offer_id}')">Delete</button>
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

async function editApplication(applicationId) {
  if (!currentUser) {
    toast('Please sign in to edit your application.', true);
    return;
  }
  // Fetch current application details
  try {
    const apps = currentUser.role === 'worker' ? await fetchJson('/api/worker/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: currentUser.identifier }) }) : [];
    const app = apps.find(a => a.application_id === applicationId);
    if (!app) {
      toast('Application not found.', true);
      return;
    }
    // Open modal to edit message
    const modalId = 'editApplicationModal';
    let modal = document.getElementById(modalId);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = modalId;
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
      modal.innerHTML = `
        <div style="background:var(--white,#fff);border-radius:16px;padding:32px;max-width:520px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.18)">
          <h2 style="margin:0 0 4px;font-size:1.3rem">✎ Edit Application</h2>
          <p id="editAppJobInfo" style="margin:0 0 18px;color:var(--text-light,#888);font-size:0.92rem"></p>
          <textarea id="editAppMessage" rows="6" placeholder="Update your application message..." style="width:100%;margin-top:6px;padding:12px;border:1.5px solid #ddd;border-radius:10px;font-size:0.95rem;resize:vertical;box-sizing:border-box"></textarea>
          <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">
            <button onclick="document.getElementById('editApplicationModal').remove()" style="padding:10px 20px;border:1.5px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;font-size:0.95rem">Cancel</button>
            <button id="editAppBtn" style="padding:10px 24px;background:var(--accent,#e85d26);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.95rem" onclick="doEditApplication('${applicationId}')">Update Application</button>
          </div>
        </div>`;
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
      document.body.appendChild(modal);
    }
    document.getElementById('editAppJobInfo').textContent = `Editing application for: ${app.job_title}`;
    document.getElementById('editAppMessage').value = app.message || '';
    modal.style.display = 'flex';
  } catch (err) {
    toast(err.message, true);
  }
}

async function doEditApplication(applicationId) {
  const modal = document.getElementById('editApplicationModal');
  if (!modal) return;
  const message = document.getElementById('editAppMessage')?.value.trim();
  const btn = document.getElementById('editAppBtn');
  if (!message) {
    toast('Please enter a message.', true);
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Updating…';
  try {
    await fetchJson('/api/application/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: currentUser.identifier, application_id: applicationId, message }),
    });
    modal.remove();
    toast('✅ Application updated');
    loadWorkerApplications();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Update Application';
    toast(err.message, true);
  }
}

function toggleApplicationEdit(applicationId) {
  const section = document.getElementById(`appEditSection-${applicationId}`);
  if (!section) return;
  section.style.display = section.style.display === 'none' ? 'block' : 'none';
}

function cancelApplicationEdit(applicationId) {
  const section = document.getElementById(`appEditSection-${applicationId}`);
  if (!section) return;
  section.style.display = 'none';
}

async function saveApplicationMessage(applicationId) {
  const textarea = document.getElementById(`appEditTextarea-${applicationId}`);
  if (!textarea) return;
  const message = textarea.value.trim();
  if (!message) {
    toast('Please enter a message before saving.', true);
    return;
  }
  try {
    await fetchJson('/api/application/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: currentUser.identifier, application_id: applicationId, message }),
    });
    toast('✅ Application message updated');
    loadWorkerApplications();
  } catch (err) {
    toast(err.message, true);
  }
}

function toggleOfferEdit(offerId) {
  const section = document.getElementById(`offerEditSection-${offerId}`);
  if (!section) return;
  section.style.display = section.style.display === 'none' ? 'block' : 'none';
}

function cancelOfferEdit(offerId) {
  const section = document.getElementById(`offerEditSection-${offerId}`);
  if (!section) return;
  section.style.display = 'none';
}

async function saveOfferMessage(offerId) {
  const textarea = document.getElementById(`offerEditTextarea-${offerId}`);
  if (!textarea) return;
  const message = textarea.value.trim();
  if (!message) {
    toast('Please enter a message before saving.', true);
    return;
  }
  try {
    await fetchJson('/api/offer/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: currentUser.identifier, offer_id: offerId, message }),
    });
    toast('✅ Offer message updated');
    loadEmployerOffers();
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

async function editOffer(offerId) {
  if (!currentUser || currentUser.role !== 'employer') {
    toast('Only employers can edit offers.', true);
    return;
  }
  // Fetch current offer details
  try {
    const offers = await fetchJson('/api/employer/offers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: currentUser.identifier }) });
    const offer = offers.find(o => o.offer_id === offerId);
    if (!offer) {
      toast('Offer not found.', true);
      return;
    }
    // Open modal to edit message
    const modalId = 'editOfferModal';
    let modal = document.getElementById(modalId);
    if (!modal) {
      modal = document.createElement('div');
      modal.id = modalId;
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
      modal.innerHTML = `
        <div style="background:var(--white,#fff);border-radius:16px;padding:32px;max-width:520px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.18)">
          <h2 style="margin:0 0 4px;font-size:1.3rem">✎ Edit Offer</h2>
          <p id="editOfferWorkerInfo" style="margin:0 0 18px;color:var(--text-light,#888);font-size:0.92rem"></p>
          <textarea id="editOfferMessage" rows="6" placeholder="Update your offer message..." style="width:100%;margin-top:6px;padding:12px;border:1.5px solid #ddd;border-radius:10px;font-size:0.95rem;resize:vertical;box-sizing:border-box"></textarea>
          <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">
            <button onclick="document.getElementById('editOfferModal').remove()" style="padding:10px 20px;border:1.5px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;font-size:0.95rem">Cancel</button>
            <button id="editOfferBtn" style="padding:10px 24px;background:var(--accent,#e85d26);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.95rem" onclick="doEditOffer('${offerId}')">Update Offer</button>
          </div>
        </div>`;
      modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
      document.body.appendChild(modal);
    }
    document.getElementById('editOfferWorkerInfo').textContent = `Editing offer to: ${offer.worker_name}`;
    document.getElementById('editOfferMessage').value = offer.message || '';
    modal.style.display = 'flex';
  } catch (err) {
    toast(err.message, true);
  }
}

async function doEditOffer(offerId) {
  const modal = document.getElementById('editOfferModal');
  if (!modal) return;
  const message = document.getElementById('editOfferMessage')?.value.trim();
  const btn = document.getElementById('editOfferBtn');
  if (!message) {
    toast('Please enter a message.', true);
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Updating…';
  try {
    await fetchJson('/api/offer/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: currentUser.identifier, offer_id: offerId, message }),
    });
    modal.remove();
    toast('✅ Offer updated');
    loadEmployerOffers();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Update Offer';
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
  const identifier = (w.email || w.phone || '').replace(/'/g, "\\'");
  return `<div class="worker-card">
    <div class="worker-top">
      <div class="worker-avatar" onclick="viewUserProfile('${w.id}','worker','${identifier}')" style="cursor:pointer;${w.photo_url ? `background-image:url(${w.photo_url});background-size:cover;background-position:center;` : ''}">${w.photo_url ? '' : '👤'}</div>
      <div style="flex:1;cursor:pointer" onclick="viewUserProfile('${w.id}','worker','${identifier}')">
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
        <button class="btn btn-primary btn-sm" onclick="contactWorker('${w.id}','${w.name.replace(/'/g,"\\'")}','${(w.role||'').replace(/'/g,"\\'")}','${(w.city||'').replace(/'/g,"\\'")}')">Contact</button>
        <button class="btn btn-outline btn-sm" onclick="viewUserProfile('${w.id}','worker','${identifier}')">View Profile</button>
      </div>
    </div>
  </div>`;
}

function renderJobCard(j) {
  const icon = j.icon || (j.category === 'Domestic' ? '🍳' : j.category === 'Trades' ? '⚡' : j.category === 'Transport' ? '🚛' : '💼');
  const employerIdentifier = (j.contact_email || j.contact_number || '').replace(/'/g, "\\'");
  const canViewEmployer = Boolean(j.employer_id || employerIdentifier);
  const employerAction = canViewEmployer ? `
        <button class="btn btn-outline btn-sm" onclick="viewUserProfile('${j.employer_id || employerIdentifier}','employer','${employerIdentifier}')">View Employer</button>
      ` : '';
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
      <button class="btn btn-primary btn-sm" style="margin-top:8px" onclick="applyJob('${j.id}')">Apply Now</button>
      ${employerAction}
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
    const [workersData, employersData, jobsData, postsData] = await Promise.all([
      fetchJson('/api/admin/workers'),
      fetchJson('/api/admin/employers'),
      fetchJson('/api/admin/jobs'),
      fetchJson('/api/admin/posts'),
    ]);
    const workerContainer = document.getElementById('adminWorkerList');
    const employerContainer = document.getElementById('adminEmployerList');
    if (workerContainer) {
      workerContainer.innerHTML = workersData
        .map(
          (w) => {
            const identifier = (w.email || w.phone || '').replace(/'/g, "\\'");
            return `
          <div class="worker-card admin-card">
            <div class="worker-top">
              <div class="worker-avatar" onclick="viewUserProfile('${w.id}','worker','${identifier}')" style="cursor:pointer;${w.photo_url ? `background-image:url(${w.photo_url});background-size:cover;background-position:center;` : ''}">${w.photo_url ? '' : '👤'}</div>
              <div style="flex:1;cursor:pointer" onclick="viewUserProfile('${w.id}','worker','${identifier}')">
                <div class="worker-name">${w.name || `${w.first_name} ${w.last_name}`}</div>
                <div class="worker-role">${w.role || w.category || 'Worker'}</div>
              </div>
              <div style="display:flex;gap:5px">
                <button class="btn btn-outline btn-sm" onclick="viewUserProfile('${w.id}','worker','${identifier}')">View Profile</button>
                <button class="btn btn-outline btn-sm" onclick="deleteAdminWorker('${w.id}')">Delete</button>
              </div>
            </div>
            <div class="worker-meta">
              <span class="meta-item">📍 ${w.city || 'N/A'}</span>
              <span class="meta-item">${w.email || ''}</span>
            </div>
            <div class="worker-skills">${(w.skills || []).map((s) => `<span class="skill-tag">${s}</span>`).join('')}</div>
          </div>`;
          }
        )
        .join('');
    }
    if (employerContainer) {
      employerContainer.innerHTML = employersData
        .map(
          (e) => {
            const identifier = (e.email || e.phone || '').replace(/'/g, "\\'");
            return `
          <div class="job-card admin-card">
            <div class="job-icon" onclick="viewUserProfile('${e.id}','employer','${identifier}')" style="cursor:pointer;${e.photo_url ? `background-image:url(${e.photo_url});background-size:cover;background-position:center;` : ''}">${e.photo_url ? '' : '🏢'}</div>
            <div class="job-info" onclick="viewUserProfile('${e.id}','employer','${identifier}')" style="cursor:pointer">
              <div class="job-title">${e.company_name || e.contact_name}</div>
              <div class="job-meta">
                <span>👤 ${e.contact_name}</span>
                <span>📍 ${e.city || 'N/A'}</span>
                <span>📱 ${e.phone || ''}</span>
              </div>
            </div>
            <div class="job-right">
              <button class="btn btn-outline btn-sm" onclick="viewUserProfile('${e.id}','employer','${identifier}')">View Profile</button>
              <button class="btn btn-outline btn-sm" onclick="deleteAdminEmployer('${e.id}')">Delete</button>
            </div>
          </div>`;
          }
        )
        .join('');
    }
    const jobSection = document.getElementById('adminJobList');
    if (jobSection) {
      jobSection.innerHTML = jobsData
        .map(
          (j) => {
            const employerIdentifier = (j.contact_email || j.contact_number || '').replace(/'/g, "\\'");
            const canViewEmployer = Boolean(j.employer_id || employerIdentifier);
            return `
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
              ${canViewEmployer ? `<button class="btn btn-outline btn-sm" onclick="viewUserProfile('${j.employer_id || employerIdentifier}','employer','${employerIdentifier}')">View Employer</button>` : ''}
              <button class="btn btn-outline btn-sm" onclick="deleteAdminJob('${j.id}')">Delete</button>
            </div>
          </div>`;
          }
        )
        .join('');
    }
    const postSection = document.getElementById('adminPostList');
    if (postSection) {
      postSection.innerHTML = postsData
        .map(
          (post) => `
          <div class="job-card admin-card">
            <div class="job-icon">📝</div>
            <div class="job-info">
              <div class="job-title">${post.title || 'Untitled Post'}</div>
              <div class="job-meta">
                <span>👤 ${post.owner_name || 'Unknown'}</span>
                <span>📄 ${post.post_type || 'Post'}</span>
                <span>🕒 ${new Date(post.created_at).toLocaleString() || 'Unknown'}</span>
              </div>
              <div style="margin-top:8px;color:var(--text-mid);">${(post.content || '').slice(0, 120)}${(post.content || '').length > 120 ? '…' : ''}</div>
            </div>
            <div class="job-right">
              <button class="btn btn-outline btn-sm" onclick="viewUserProfile('${post.owner_id}', '${post.owner_role}', '${(post.owner_identifier || '').replace(/'/g, "\\'")}')">View Profile</button>
              <button class="btn btn-outline btn-sm" onclick="deleteAdminPost('${post.id}')">Delete</button>
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

async function deleteAdminPost(id) {
  if (!confirm('Delete this post permanently?')) return;
  try {
    await fetchJson('/api/admin/delete-post', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    toast('Post deleted successfully');
    renderAdminDashboard();
  } catch (err) {
    toast(err.message, true);
  }
}

async function renderProfile() {
  if (!viewedUser && !currentUser) {
    toast('Please sign in to view profiles', true);
    return;
  }
  
  // Determine whose profile to show
  const profileUser = viewedUser || currentUser;
  const isOwnProfile = !viewedUser || (currentUser && (
    (viewedUser.id && currentUser.profile?.id && viewedUser.id === currentUser.profile.id) ||
    (viewedUser.identifier && currentUser.identifier && viewedUser.identifier === currentUser.identifier)
  ));
  
  // Update page title and back button
  const titleEl = document.getElementById('profilePageTitle');
  const subtitleEl = document.getElementById('profilePageSubtitle');
  const backBtn = document.getElementById('backToMyProfileBtn');
  
  if (isOwnProfile) {
    titleEl.textContent = 'My Profile';
    subtitleEl.textContent = 'View your account details, posts, applications and offers.';
    backBtn.style.display = 'none';
  } else {
    titleEl.textContent = `${profileUser.role === 'worker' ? 'Worker' : 'Employer'} Profile`;
    subtitleEl.textContent = `Viewing ${profileUser.profile?.name || 'this user'}'s profile and posts.`;
    backBtn.style.display = 'inline-flex';
  }
  
  try {
    const data = await fetchJson('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: profileUser.role, identifier: profileUser.identifier || currentUser.identifier }),
    });
    
    // Store profile data for later use
    profileUser.profile = data;
    
    // Update profile details
    document.getElementById('profileName').textContent = data.name || `${data.first_name || ''} ${data.last_name || ''}`.trim() || 'Profile';
    document.getElementById('profileRole').textContent = data.role ? data.role.charAt(0).toUpperCase() + data.role.slice(1) : profileUser.role;
    document.getElementById('profileEmail').textContent = data.email || '—';
    document.getElementById('profilePhone').textContent = data.phone || '—';
    document.getElementById('profileLocation').textContent = data.city ? `${data.city}${data.state ? ', ' + data.state : ''}` : '—';
    document.getElementById('profileJoined').textContent = data.created_at ? new Date(data.created_at).toLocaleDateString('en-IN') : '—';
    
    // Update profile photo
    if (data.photo_url) {
      document.getElementById('profilePhotoEl').style.backgroundImage = `url(${data.photo_url})`;
      document.getElementById('profilePhotoEl').style.backgroundSize = 'cover';
      document.getElementById('profilePhotoEl').style.backgroundPosition = 'center';
      document.getElementById('profilePhotoEl').textContent = '';
    } else {
      document.getElementById('profilePhotoEl').style.backgroundImage = '';
      document.getElementById('profilePhotoEl').textContent = profileUser.role === 'worker' ? '👷' : '🏢';
    }

    const profileActionContainer = document.getElementById('profileActionContainer');
    if (profileActionContainer) {
      profileActionContainer.innerHTML = isOwnProfile
        ? '<button class="btn btn-primary btn-sm" onclick="openEditProfileModal()">✎ Edit Profile</button>'
        : '';
    }
    
    // Update extra profile information
    const extra = document.getElementById('profileExtra');
    if (extra) {
      if (profileUser.role === 'worker') {
        extra.innerHTML = `
          <div class="profile-detail"><strong>Experience:</strong> ${data.experience_years ? data.experience_years + ' years' : 'N/A'}</div>
          <div class="profile-detail"><strong>Expected Salary:</strong> ${data.salary_expected || 'N/A'}</div>
          <div class="profile-detail"><strong>Availability:</strong> ${data.available || 'N/A'}</div>
          <div class="profile-detail"><strong>Skills:</strong> ${(data.skills || []).join(', ') || 'N/A'}</div>
        `;
      } else if (profileUser.role === 'employer') {
        extra.innerHTML = `
          <div class="profile-detail"><strong>Company:</strong> ${data.company_name || 'N/A'}</div>
          <div class="profile-detail"><strong>Type:</strong> ${data.employer_type || 'N/A'}</div>
          <div class="profile-detail"><strong>Workers Needed:</strong> ${data.workers_needed || 'N/A'}</div>
          <div class="profile-detail"><strong>Description:</strong> ${data.description || data.employer_description || 'N/A'}</div>
        `;
      }
    }
    
    // Setup profile tab bar
    const tabBar = document.getElementById('profileTabBar');
    if (tabBar) {
      const tabs = ['details'];
      const tabLabels = { details: '📋 Details' };
      
      if (profileUser.role === 'worker' || profileUser.role === 'employer') {
        tabs.push('posts');
        tabLabels.posts = '📝 Posts';
        if (isOwnProfile) {
          tabs.push('applications');
          if (profileUser.role === 'worker') {
            tabLabels.applications = '📤 Applications Sent';
          } else {
            tabLabels.applications = '📥 Applications Received';
          }
          tabs.push('offers');
          if (profileUser.role === 'worker') {
            tabLabels.offers = '🎁 Offers Received';
          } else {
            tabLabels.offers = '🎁 Offers Sent';
          }
        }
      }
      
      tabBar.innerHTML = tabs.map(tab => 
        `<button class="profile-tab-btn${tab === 'details' ? ' active' : ''}" onclick="showProfileTab('${tab}')">${tabLabels[tab]}</button>`
      ).join('');
      tabBar.style.display = 'flex';
    }
    
    // Load initial data
    await loadUserPosts(profileUser);
    
    // Show the profile page
    showProfileTab('details');
    
    // Keep viewedUser so profile state remains accurate while browsing
    // It will be reset when the user returns to their own profile.
    
  } catch (err) {
    toast(err.message, true);
  }
}

function openEditProfileModal() {
  if (!currentUser) {
    toast('Please sign in to edit your profile.', true);
    return;
  }
  const modalId = 'editProfileModal';
  let modal = document.getElementById(modalId);
  if (!modal) {
    modal = document.createElement('div');
    modal.id = modalId;
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px';
    modal.innerHTML = `
      <div style="background:var(--white,#fff);border-radius:16px;padding:32px;max-width:600px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.18);max-height:80vh;overflow-y:auto">
        <h2 style="margin:0 0 4px;font-size:1.3rem">✎ Edit Profile</h2>
        <form id="editProfileForm" style="display:flex;flex-direction:column;gap:16px;margin-top:18px">
          <div style="display:flex;gap:10px">
            <label style="flex:1">
              <span style="display:block;font-weight:600;margin-bottom:4px">Email</span>
              <input id="editEmail" type="email" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" required>
            </label>
            <label style="flex:1">
              <span style="display:block;font-weight:600;margin-bottom:4px">Phone</span>
              <input id="editPhone" type="tel" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" required>
            </label>
          </div>
          ${currentUser.role === 'worker' ? `
          <div style="display:flex;gap:10px">
            <label style="flex:1">
              <span style="display:block;font-weight:600;margin-bottom:4px">First Name</span>
              <input id="editFirstName" type="text" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" required>
            </label>
            <label style="flex:1">
              <span style="display:block;font-weight:600;margin-bottom:4px">Last Name</span>
              <input id="editLastName" type="text" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" required>
            </label>
          </div>
          <label>
            <span style="display:block;font-weight:600;margin-bottom:4px">Role/Skill</span>
            <input id="editRole" type="text" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" required>
          </label>
          <div style="display:flex;gap:10px">
            <label style="flex:1">
              <span style="display:block;font-weight:600;margin-bottom:4px">City</span>
              <input id="editCity" type="text" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" required>
            </label>
            <label style="flex:1">
              <span style="display:block;font-weight:600;margin-bottom:4px">State</span>
              <input id="editState" type="text" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" required>
            </label>
          </div>
          <div style="display:flex;gap:10px">
            <label style="flex:1">
              <span style="display:block;font-weight:600;margin-bottom:4px">Experience (years)</span>
              <input id="editExperience" type="number" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" min="0">
            </label>
            <label style="flex:1">
              <span style="display:block;font-weight:600;margin-bottom:4px">Expected Salary</span>
              <input id="editSalary" type="text" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px">
            </label>
          </div>
          <label>
            <span style="display:block;font-weight:600;margin-bottom:4px">Skills (comma separated)</span>
            <input id="editSkills" type="text" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px">
          </label>
          <label>
            <span style="display:block;font-weight:600;margin-bottom:4px">Availability</span>
            <input id="editAvailability" type="text" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" placeholder="Available / Busy / Flexible">
          </label>
          ` : `
          <label>
            <span style="display:block;font-weight:600;margin-bottom:4px">Company Name</span>
            <input id="editCompanyName" type="text" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" required>
          </label>
          <label>
            <span style="display:block;font-weight:600;margin-bottom:4px">Contact Name</span>
            <input id="editContactName" type="text" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" required>
          </label>
          <label>
            <span style="display:block;font-weight:600;margin-bottom:4px">Employer Type</span>
            <input id="editEmployerType" type="text" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" required>
          </label>
          <div style="display:flex;gap:10px">
            <label style="flex:1">
              <span style="display:block;font-weight:600;margin-bottom:4px">City</span>
              <input id="editCity" type="text" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" required>
            </label>
            <label style="flex:1">
              <span style="display:block;font-weight:600;margin-bottom:4px">State</span>
              <input id="editState" type="text" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" required>
            </label>
          </div>
          <label>
            <span style="display:block;font-weight:600;margin-bottom:4px">Workers Needed</span>
            <input id="editWorkersNeeded" type="number" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px" min="0">
          </label>
          <label>
            <span style="display:block;font-weight:600;margin-bottom:4px">Description</span>
            <textarea id="editDescription" style="width:100%;padding:12px;border:1.5px solid #ddd;border-radius:10px;font-size:0.95rem;resize:vertical;min-height:90px"></textarea>
          </label>
          `}
          <div style="display:flex;gap:10px;margin-top:18px;justify-content:flex-end">
            <button type="button" onclick="document.getElementById('editProfileModal').remove()" style="padding:10px 20px;border:1.5px solid #ddd;background:#fff;border-radius:8px;cursor:pointer;font-size:0.95rem">Cancel</button>
            <button type="submit" id="editProfileBtn" style="padding:10px 24px;background:var(--accent,#e85d26);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.95rem">Update Profile</button>
          </div>
        </form>
      </div>`;
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.body.appendChild(modal);
  }
  // Populate fields
  const profile = currentUser.profile || {};
  document.getElementById('editEmail').value = profile.email || '';
  document.getElementById('editPhone').value = profile.phone || '';
  if (currentUser.role === 'worker') {
    document.getElementById('editFirstName').value = profile.first_name || '';
    document.getElementById('editLastName').value = profile.last_name || '';
    document.getElementById('editRole').value = profile.role || '';
    document.getElementById('editCity').value = profile.city || '';
    document.getElementById('editState').value = profile.state || '';
    document.getElementById('editExperience').value = profile.experience_years || '';
    document.getElementById('editSalary').value = profile.salary_expected || '';
    document.getElementById('editSkills').value = (profile.skills || []).join(', ');
  } else {
    document.getElementById('editCompanyName').value = profile.company_name || '';
    document.getElementById('editContactName').value = profile.contact_name || '';
    document.getElementById('editEmployerType').value = profile.employer_type || '';
    document.getElementById('editCity').value = profile.city || '';
    document.getElementById('editState').value = profile.state || '';
    document.getElementById('editWorkersNeeded').value = profile.workers_needed || '';
  }
  modal.style.display = 'flex';
  // Handle form submit
  document.getElementById('editProfileForm').onsubmit = doEditProfile;
}

async function doEditProfile(e) {
  e.preventDefault();
  const btn = document.getElementById('editProfileBtn');
  btn.disabled = true;
  btn.textContent = 'Updating…';
  try {
    const payload = {
      identifier: currentUser.identifier,
      role: currentUser.role,
      email: document.getElementById('editEmail').value.trim(),
      phone: document.getElementById('editPhone').value.trim(),
    };
    if (currentUser.role === 'worker') {
      payload.first_name = document.getElementById('editFirstName').value.trim();
      payload.last_name = document.getElementById('editLastName').value.trim();
      payload.role = document.getElementById('editRole').value.trim();
      payload.city = document.getElementById('editCity').value.trim();
      payload.state = document.getElementById('editState').value.trim();
      payload.experience_years = document.getElementById('editExperience').value;
      payload.salary_expected = document.getElementById('editSalary').value.trim();
      payload.skills = document.getElementById('editSkills').value.trim().split(',').map(s => s.trim()).filter(s => s);
      payload.available = document.getElementById('editAvailability').value.trim();
    } else {
      payload.company_name = document.getElementById('editCompanyName').value.trim();
      payload.contact_name = document.getElementById('editContactName').value.trim();
      payload.employer_type = document.getElementById('editEmployerType').value.trim();
      payload.city = document.getElementById('editCity').value.trim();
      payload.state = document.getElementById('editState').value.trim();
      payload.workers_needed = document.getElementById('editWorkersNeeded').value;
      payload.description = document.getElementById('editDescription').value.trim();
    }
    await fetchJson('/api/profile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    document.getElementById('editProfileModal').remove();
    toast('✅ Profile updated successfully!');
    // Reload profile
    await loadCurrentUserProfile();
    renderProfile();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Update Profile';
    toast(err.message, true);
  }
}

function showProfileTab(tab) {
  // Hide all tabs
  document.getElementById('profileTab_details').style.display = 'none';
  document.getElementById('profileTab_posts').style.display = 'none';
  document.getElementById('profileTab_applications').style.display = 'none';
  document.getElementById('profileTab_offers').style.display = 'none';
  
  // Remove active class from all buttons
  document.querySelectorAll('#profileTabBar .profile-tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  // Show selected tab and activate button
  const selectedTab = document.getElementById(`profileTab_${tab}`);
  if (selectedTab) {
    selectedTab.style.display = 'block';
  }
  
  // Activate corresponding button
  const buttons = document.querySelectorAll('#profileTabBar .profile-tab-btn');
  const tabIndices = ['details', 'posts', 'applications', 'offers'];
  const tabIndex = tabIndices.indexOf(tab);
  if (buttons[tabIndex]) {
    buttons[tabIndex].classList.add('active');
  }
  
  // Load data for specific tabs
  if (tab === 'applications') {
    if (currentUser.role === 'worker') {
      loadWorkerApplications();
    } else if (currentUser.role === 'employer') {
      loadEmployerApplications();
    }
  } else if (tab === 'offers') {
    if (currentUser.role === 'worker') {
      loadWorkerOffers();
    } else if (currentUser.role === 'employer') {
      loadEmployerOffers();
    }
  } else if (tab === 'posts') {
    loadUserPosts();
  }
}

function toggleCreatePostForm() {
  const form = document.getElementById('createPostForm');
  if (form) {
    form.style.display = form.style.display === 'none' ? 'block' : 'none';
    if (form.style.display === 'block') {
      document.getElementById('postTitle').focus();
    }
  }
}

async function doCreatePost() {
  const title = document.getElementById('postTitle').value.trim();
  const content = document.getElementById('postContent').value.trim();
  const postType = document.getElementById('postType').value;
  
  if (!content) {
    toast('Please enter post content', true);
    return;
  }
  
  try {
    const result = await fetchJson('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: currentUser.identifier,
        role: currentUser.role,
        title,
        content,
        post_type: postType
      })
    });
    
    toast('✅ Post created successfully!');
    document.getElementById('postTitle').value = '';
    document.getElementById('postContent').value = '';
    toggleCreatePostForm();
    loadUserPosts();
  } catch (err) {
    toast(err.message, true);
  }
}

async function loadUserPosts(profileUser = viewedUser || currentUser) {
  const container = document.getElementById('postsList');
  if (!container) return;
  
  container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div>Loading posts...</div>';
  
  const isOwnProfile = !viewedUser || (currentUser && (
    (profileUser.id && currentUser.profile?.id && profileUser.id === currentUser.profile.id) ||
    (profileUser.identifier && currentUser.identifier && profileUser.identifier === currentUser.identifier)
  ));
  
  try {
    const posts = await fetchJson('/api/posts/my', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: profileUser.identifier || currentUser.identifier,
        role: profileUser.role
      })
    });
    userPosts = posts;
    
    if (posts.length === 0) {
      const userName = profileUser.profile?.name || 'This user';
      container.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📝</div><p>${userName} hasn't posted anything yet.</p></div>`;
      return;
    }
    
    container.innerHTML = posts.map(post => `
      <div class="post-item">
        <div class="post-header">
          <div>
            <div class="post-title">${post.title || 'Untitled Post'}</div>
            <div class="post-meta">
              <span>${post.post_type || 'Post'}</span>
              <span>${post.created_at ? new Date(post.created_at).toLocaleDateString('en-IN') : 'Recently'}</span>
            </div>
          </div>
          ${isOwnProfile ? `
          <div class="post-actions">
            <button class="btn btn-outline btn-sm" onclick="editPost('${post.id}')">✎ Edit</button>
            <button class="btn btn-outline btn-sm" style="color:#c23d32;border-color:#c23d32" onclick="deletePost('${post.id}')">🗑 Delete</button>
          </div>
          ` : ''}
        </div>
        <div class="post-content">${post.content}</div>
        ${post.photo_url ? `<img src="${post.photo_url}" style="width:100%;max-height:300px;object-fit:cover;border-radius:var(--radius);margin-top:10px">` : ''}
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><p>' + err.message + '</p></div>';
  }
}

async function editPost(postId) {
  // Find the post data
  const post = allPosts.find(p => p.id === postId) || userPosts.find(p => p.id === postId);
  if (!post) {
    toast('Post not found', true);
    return;
  }
  
  // Check if user owns this post
  const ownsPost = post.owner_id ? currentUser?.profile?.id === post.owner_id : true;
  if (!ownsPost) {
    toast('You can only edit your own posts', true);
    return;
  }
  
  // Create edit modal
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content edit-post-modal">
      <div class="modal-header">
        <h3>Edit Post</h3>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-body">
        <form id="editPostForm-${postId}" onsubmit="submitEditPost(event, '${postId}')">
          <div class="form-group full" style="margin-bottom:14px">
            <label class="form-label">Post Title</label>
            <input id="editPostTitle-${postId}" class="form-input" value="${(post.title || '').replace(/"/g, '&quot;')}" placeholder="e.g., My Recent Achievement, New Skill Acquired">
          </div>
          <div class="form-group full" style="margin-bottom:14px">
            <label class="form-label">Post Content</label>
            <textarea id="editPostContent-${postId}" class="form-textarea" style="min-height:120px" placeholder="Share your achievement, new skill, or experience...">${post.content}</textarea>
          </div>
          <div class="form-group full" style="margin-bottom:14px">
            <label class="form-label">Type</label>
            <select id="editPostType-${postId}" class="form-select">
              <option value="achievement" ${post.post_type === 'achievement' ? 'selected' : ''}>Achievement</option>
              <option value="skill" ${post.post_type === 'skill' ? 'selected' : ''}>Skill</option>
              <option value="qualification" ${post.post_type === 'qualification' ? 'selected' : ''}>Qualification</option>
              <option value="other" ${post.post_type === 'other' ? 'selected' : ''}>Other</option>
            </select>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <button type="button" class="btn btn-outline cancel-edit-btn">Cancel</button>
            <button type="submit" class="btn btn-primary">Update Post</button>
          </div>
        </form>
      </div>
    </div>
  `;
  
  // Add event listeners
  modal.addEventListener('click', function(e) {
    // Close modal when clicking on overlay
    if (e.target === modal) {
      modal.remove();
    }
  });
  
  // Close button
  const closeBtn = modal.querySelector('.modal-close');
  closeBtn.addEventListener('click', function() {
    modal.remove();
  });
  
  // Cancel button
  const cancelBtn = modal.querySelector('.cancel-edit-btn');
  cancelBtn.addEventListener('click', function() {
    modal.remove();
  });
  
  // Prevent modal content clicks from closing modal
  const modalContent = modal.querySelector('.modal-content');
  modalContent.addEventListener('click', function(e) {
    e.stopPropagation();
  });
  
  document.body.appendChild(modal);
  
  // Focus on content textarea
  setTimeout(() => {
    const contentTextarea = document.getElementById(`editPostContent-${postId}`);
    if (contentTextarea) {
      contentTextarea.focus();
      // Move cursor to end
      contentTextarea.setSelectionRange(contentTextarea.value.length, contentTextarea.value.length);
    }
  }, 100);
}

async function submitEditPost(event, postId) {
  event.preventDefault();
  
  const title = document.getElementById(`editPostTitle-${postId}`).value.trim();
  const content = document.getElementById(`editPostContent-${postId}`).value.trim();
  const postType = document.getElementById(`editPostType-${postId}`).value;
  
  if (!content) {
    toast('Post content is required', true);
    return;
  }
  
  try {
    await fetchJson(`/api/posts/${postId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: currentUser.identifier,
        role: currentUser.role,
        content: content,
        title: title,
        post_type: postType
      })
    });
    
    toast('✅ Post updated successfully!');
    
    // Close modal
    event.target.closest('.modal-overlay').remove();
    
    // Reload posts
    loadPostsFeed();
    if (typeof loadUserPosts === 'function') {
      loadUserPosts();
    }
  } catch (err) {
    toast(err.message, true);
  }
}

async function deletePost(postId) {
  if (!confirm('Are you sure you want to delete this post? This cannot be undone.')) return;
  
  try {
    await fetchJson(`/api/posts/${postId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: currentUser.identifier,
        role: currentUser.role
      })
    });
    
    toast('✅ Post deleted successfully!');
    loadUserPosts();
  } catch (err) {
    toast(err.message, true);
  }
}

// ---------------------------------------------------------------------------
// Post Interactions (Likes, Comments, Shares)
// ---------------------------------------------------------------------------

async function loadPostsInteractions(postIds) {
  if (!postIds || postIds.length === 0) return;
  
  try {
    // Load interaction data for all posts in parallel
    const promises = postIds.map(async (postId) => {
      try {
        const [likesData, commentsData] = await Promise.all([
          fetchJson(`/api/posts/${postId}/likes?identifier=${encodeURIComponent(currentUser?.identifier || '')}&role=${currentUser?.role || ''}`),
          fetchJson(`/api/posts/${postId}/comments`)
        ]);
        
        return {
          postId,
          like_count: likesData.like_count,
          user_liked: likesData.liked,
          comment_count: commentsData.length,
          comments: commentsData
        };
      } catch (err) {
        console.error(`Error loading interactions for post ${postId}:`, err);
        return { postId, like_count: 0, user_liked: false, comment_count: 0, comments: [] };
      }
    });
    
    const interactions = await Promise.all(promises);
    
    // Update the posts data and DOM
    interactions.forEach(({ postId, like_count, user_liked, comment_count, comments }) => {
      // Update post data
      const postElement = document.querySelector(`[data-post-id="${postId}"]`);
      if (postElement) {
        // Update stats
        const likeStat = postElement.querySelector('.like-stat .stat-count');
        const commentStat = postElement.querySelector('.comment-stat .stat-count');
        
        if (likeStat) likeStat.textContent = like_count;
        if (commentStat) commentStat.textContent = comment_count;
        
        // Update like button
        const likeBtn = postElement.querySelector('.like-btn');
        if (likeBtn) {
          likeBtn.classList.toggle('liked', user_liked);
          const icon = likeBtn.querySelector('.action-icon');
          const text = likeBtn.querySelector('.action-text');
          if (icon) icon.textContent = user_liked ? '❤️' : '👍';
          if (text) text.textContent = user_liked ? 'Liked' : 'Like';
        }
        
        // Store comments data
        postElement.dataset.comments = JSON.stringify(comments);
      }
    });
  } catch (err) {
    console.error('Error loading posts interactions:', err);
  }
}

async function toggleLike(postId) {
  if (!currentUser) {
    toast('Please log in to like posts', true);
    return;
  }
  
  try {
    const response = await fetchJson(`/api/posts/${postId}/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: currentUser.identifier,
        role: currentUser.role
      })
    });
    
    // Update the UI immediately
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    if (postElement) {
      const likeBtn = postElement.querySelector('.like-btn');
      const likeStat = postElement.querySelector('.like-stat .stat-count');
      
      if (likeBtn) {
        likeBtn.classList.toggle('liked', response.liked);
        const icon = likeBtn.querySelector('.action-icon');
        const text = likeBtn.querySelector('.action-text');
        if (icon) icon.textContent = response.liked ? '❤️' : '👍';
        if (text) text.textContent = response.liked ? 'Liked' : 'Like';
      }
      
      if (likeStat) {
        likeStat.textContent = response.like_count;
        const label = likeStat.nextElementSibling;
        if (label) label.textContent = response.like_count === 1 ? 'Like' : 'Likes';
      }
    }
    
    toast(response.liked ? '❤️ Post liked!' : '👍 Like removed');
  } catch (err) {
    toast(err.message, true);
  }
}

async function showComments(postId) {
  const commentsSection = document.getElementById(`comments-${postId}`);
  const commentsList = document.getElementById(`comments-list-${postId}`);
  
  if (!commentsSection || !commentsList) return;
  
  // Toggle visibility
  const isVisible = commentsSection.style.display !== 'none';
  
  if (isVisible) {
    commentsSection.style.display = 'none';
    return;
  }
  
  commentsSection.style.display = 'block';
  
  // Load comments if not already loaded
  if (!commentsList.dataset.loaded) {
    try {
      const comments = await fetchJson(`/api/posts/${postId}/comments`);
      renderComments(postId, comments);
      commentsList.dataset.loaded = 'true';
    } catch (err) {
      commentsList.innerHTML = '<div class="error-message">Failed to load comments</div>';
      console.error('Error loading comments:', err);
    }
  }
}

function renderComments(postId, comments) {
  const commentsList = document.getElementById(`comments-list-${postId}`);
  if (!commentsList) return;
  
  if (!comments || comments.length === 0) {
    commentsList.innerHTML = '<div class="no-comments">No comments yet. Be the first to comment!</div>';
    return;
  }
  
  commentsList.innerHTML = comments.map(comment => `
    <div class="comment-item">
      <div class="comment-avatar">
        ${comment.user_photo ? 
          `<img src="${comment.user_photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : 
          '👤'}
      </div>
      <div class="comment-content">
        <div class="comment-header">
          <span class="comment-author">${comment.user_name}</span>
          <span class="comment-time">${timeAgo(comment.created_at)}</span>
        </div>
        <div class="comment-text">${comment.content}</div>
      </div>
    </div>
  `).join('');
}

async function addComment(postId) {
  if (!currentUser) {
    toast('Please log in to comment', true);
    return;
  }
  
  const input = document.getElementById(`comment-input-${postId}`);
  if (!input) return;
  
  const content = input.value.trim();
  if (!content) {
    toast('Please enter a comment', true);
    return;
  }
  
  if (content.length > 500) {
    toast('Comment must be under 500 characters', true);
    return;
  }
  
  try {
    const response = await fetchJson(`/api/posts/${postId}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: currentUser.identifier,
        role: currentUser.role,
        content: content
      })
    });
    
    // Clear input
    input.value = '';
    
    // Add comment to UI immediately
    const commentsList = document.getElementById(`comments-list-${postId}`);
    if (commentsList) {
      // Get current user info
      const userName = currentUser.role === 'worker' ? 
        `${currentUser.profile.first_name} ${currentUser.profile.last_name}`.trim() || 'Worker' :
        currentUser.profile.company_name || currentUser.profile.contact_name || 'Employer';
      
      const newComment = {
        user_name: userName,
        user_photo: currentUser.profile.photo_url,
        content: content,
        created_at: new Date().toISOString()
      };
      
      // Add to existing comments or create new list
      const existingComments = commentsList.querySelectorAll('.comment-item');
      const noCommentsMsg = commentsList.querySelector('.no-comments');
      
      if (noCommentsMsg) {
        noCommentsMsg.remove();
      }
      
      const commentHtml = `
        <div class="comment-item">
          <div class="comment-avatar">
            ${newComment.user_photo ? 
              `<img src="${newComment.user_photo}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : 
              '👤'}
          </div>
          <div class="comment-content">
            <div class="comment-header">
              <span class="comment-author">${newComment.user_name}</span>
              <span class="comment-time">just now</span>
            </div>
            <div class="comment-text">${newComment.content}</div>
          </div>
        </div>
      `;
      
      commentsList.insertAdjacentHTML('beforeend', commentHtml);
    }
    
    // Update comment count
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    if (postElement) {
      const commentStat = postElement.querySelector('.comment-stat .stat-count');
      if (commentStat) {
        const currentCount = parseInt(commentStat.textContent) || 0;
        commentStat.textContent = currentCount + 1;
        const label = commentStat.nextElementSibling;
        if (label) label.textContent = (currentCount + 1) === 1 ? 'Comment' : 'Comments';
      }
    }
    
    toast('💬 Comment added!');
  } catch (err) {
    toast(err.message, true);
  }
}

async function sharePost(postId) {
  if (!currentUser) {
    toast('Please log in to share posts', true);
    return;
  }
  
  // Show share options modal
  showShareOptions(postId);
}

function showShareOptions(postId) {
  // Find the post data - try multiple sources
  let post = null;

  // First try allPosts array
  if (typeof allPosts !== 'undefined' && allPosts.length > 0) {
    post = allPosts.find(p => p.id === postId);
  }

  // If not found, try postUsers map (from the current post rendering)
  if (!post && typeof postUsers !== 'undefined') {
    const postElement = document.querySelector(`[data-post-id="${postId}"]`);
    if (postElement) {
      const user = postUsers[postId];
      if (user) {
        // Extract post data from the DOM element
        const titleElement = postElement.querySelector('.feed-post-title');
        const contentElement = postElement.querySelector('.feed-post-content');

        post = {
          id: postId,
          title: titleElement ? titleElement.textContent : '',
          content: contentElement ? contentElement.textContent : '',
          owner_name: user.name || 'Unknown User'
        };
      }
    }
  }

  // If still no post data, create a basic post object
  if (!post) {
    post = {
      id: postId,
      title: 'SkillMatch Post',
      content: 'Check out this post on SkillMatch!',
      owner_name: 'SkillMatch User'
    };
  }

  // Remove any existing modal first
  const existingModal = document.querySelector('.modal-overlay');
  if (existingModal) {
    existingModal.remove();
  }

  // Create share modal
  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-content share-modal">
      <div class="modal-header">
        <h3>Share Post</h3>
        <button class="modal-close" type="button">×</button>
      </div>
      <div class="modal-body">
        <div class="share-options">
          <button class="share-option whatsapp" type="button" data-platform="whatsapp">
            <span class="share-icon">📱</span>
            <span class="share-text">WhatsApp</span>
          </button>
          <button class="share-option gmail" type="button" data-platform="gmail">
            <span class="share-icon">📧</span>
            <span class="share-text">Gmail</span>
          </button>
          <button class="share-option twitter" type="button" data-platform="twitter">
            <span class="share-icon">🐦</span>
            <span class="share-text">Twitter</span>
          </button>
          <button class="share-option facebook" type="button" data-platform="facebook">
            <span class="share-icon">📘</span>
            <span class="share-text">Facebook</span>
          </button>
          <button class="share-option linkedin" type="button" data-platform="linkedin">
            <span class="share-icon">💼</span>
            <span class="share-text">LinkedIn</span>
          </button>
          <button class="share-option copy-link" type="button" data-platform="copy">
            <span class="share-icon">🔗</span>
            <span class="share-text">Copy Link</span>
          </button>
        </div>
        <div class="share-divider">
          <span>Or share on SkillMatch</span>
        </div>
        <button class="btn btn-primary share-platform-btn" type="button">
          🔗 Share on SkillMatch
        </button>
      </div>
    </div>
  `;

  // Add event listeners with proper handling
  const closeModal = () => modal.remove();

  // Close on overlay click
  modal.addEventListener('click', function(e) {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Close button
  const closeBtn = modal.querySelector('.modal-close');
  closeBtn.addEventListener('click', closeModal);

  // Share option buttons
  const shareButtons = modal.querySelectorAll('.share-option');
  shareButtons.forEach(button => {
    button.addEventListener('click', function(e) {
      e.stopPropagation(); // Prevent modal close
      const platform = this.getAttribute('data-platform');
      try {
        switch(platform) {
          case 'whatsapp':
            shareToWhatsApp(postId, post);
            break;
          case 'gmail':
            shareToGmail(postId, post);
            break;
          case 'twitter':
            shareToTwitter(postId, post);
            break;
          case 'facebook':
            shareToFacebook(postId, post);
            break;
          case 'linkedin':
            shareToLinkedIn(postId, post);
            break;
          case 'copy':
            copyPostLink(postId, post);
            break;
        }
        closeModal(); // Close modal after sharing
      } catch (error) {
        console.error('Error sharing to', platform, error);
        toast('Error sharing post', true);
      }
    });
  });

  // Share on platform button
  const platformBtn = modal.querySelector('.share-platform-btn');
  platformBtn.addEventListener('click', function(e) {
    e.stopPropagation(); // Prevent modal close
    closeModal(); // Close modal first
    try {
      shareOnPlatform(postId);
    } catch (error) {
      console.error('Error sharing on platform:', error);
      toast('Error sharing post', true);
    }
  });

  // Prevent modal content clicks from closing modal
  const modalContent = modal.querySelector('.modal-content');
  modalContent.addEventListener('click', function(e) {
    e.stopPropagation();
  });

  document.body.appendChild(modal);
}

async function shareOnPlatform(postId) {
  try {
    const response = await fetchJson(`/api/posts/${postId}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: currentUser.identifier,
        role: currentUser.role
      })
    });
    
    toast('🔗 Post shared successfully!');
    loadPostsFeed();
  } catch (err) {
    toast(err.message, true);
  }
}

function getPostShareText(postId, postData) {
  const post = postData || allPosts.find(p => p.id === postId);
  if (!post) return 'Check out this post on SkillMatch!';
  
  const title = post.title ? `"${post.title}"` : 'Post';
  const content = post.content && post.content.length > 200 ? post.content.substring(0, 200) + '...' : (post.content || '');
  const author = post.owner_name || 'SkillMatch User';
  
  return `Check out this post by ${author}: ${title}\n\n${content}\n\nShared from SkillMatch`;
}

function shareToWhatsApp(postId, postData) {
  const text = encodeURIComponent(getPostShareText(postId, postData));
  const url = `https://wa.me/?text=${text}`;
  window.open(url, '_blank');
  toast('📱 Opening WhatsApp...');
}

function shareToGmail(postId, postData) {
  const post = postData || allPosts.find(p => p.id === postId);
  if (!post) {
    toast('Post data not available', true);
    return;
  }
  
  const subject = encodeURIComponent(`Shared Post: ${post.title || 'SkillMatch Post'}`);
  const body = encodeURIComponent(getPostShareText(postId, postData));
  const url = `https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${body}`;
  window.open(url, '_blank');
  toast('📧 Opening Gmail...');
}

function shareToTwitter(postId, postData) {
  const text = encodeURIComponent(getPostShareText(postId, postData));
  const url = `https://twitter.com/intent/tweet?text=${text}`;
  window.open(url, '_blank');
  toast('🐦 Opening Twitter...');
}

function shareToFacebook(postId, postData) {
  const post = postData || allPosts.find(p => p.id === postId);
  if (!post) {
    toast('Post data not available', true);
    return;
  }
  
  const url = encodeURIComponent(`${window.location.origin}/#posts`);
  const text = encodeURIComponent(getPostShareText(postId, postData));
  const shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${url}&quote=${text}`;
  window.open(shareUrl, '_blank');
  toast('📘 Opening Facebook...');
}

function shareToLinkedIn(postId, postData) {
  const post = postData || allPosts.find(p => p.id === postId);
  if (!post) {
    toast('Post data not available', true);
    return;
  }
  
  const url = encodeURIComponent(`${window.location.origin}/#posts`);
  const title = encodeURIComponent(post.title || 'SkillMatch Post');
  const summary = encodeURIComponent(post.content && post.content.length > 200 ? post.content.substring(0, 200) + '...' : (post.content || ''));
  const shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${url}&title=${title}&summary=${summary}`;
  window.open(shareUrl, '_blank');
  toast('💼 Opening LinkedIn...');
}

function copyPostLink(postId, postData) {
  const url = `${window.location.origin}/#posts`;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(url).then(() => {
      toast('🔗 Link copied to clipboard!');
    }).catch(() => {
      fallbackCopyTextToClipboard(url);
    });
  } else {
    fallbackCopyTextToClipboard(url);
  }
}

function fallbackCopyTextToClipboard(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    toast('🔗 Link copied to clipboard!');
  } catch (err) {
    toast('Failed to copy link', true);
  }
  document.body.removeChild(textArea);
}

function copyPostLink(postId, postData) {
  const url = `${window.location.origin}/#posts`;
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(url).then(() => {
      toast('🔗 Link copied to clipboard!');
    }).catch(() => {
      fallbackCopyTextToClipboard(url);
    });
  } else {
    fallbackCopyTextToClipboard(url);
  }
}

function fallbackCopyTextToClipboard(text) {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
    toast('🔗 Link copied to clipboard!');
  } catch (err) {
    toast('Failed to copy link', true);
  }
  document.body.removeChild(textArea);
}

function showLikes(postId) {
  // For now, just show a toast. Could be expanded to show who liked the post
  toast('Feature coming soon: View who liked this post');
}

async function loadWorkerApplications() {
  const container = document.getElementById('applicationsList');
  if (!container) return;
  
  container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div>Loading applications...</div>';
  
  try {
    const applications = await fetchJson('/api/worker/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: currentUser.identifier
      })
    });
    
    if (applications.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📤</div><p>You haven\'t applied for any jobs yet.</p></div>';
      return;
    }
    
    container.innerHTML = applications.map(app => `
      <div class="app-card">
        <div class="app-card-header">
          <div>
            <div class="app-card-title">${app.job_title}</div>
            <div class="app-card-meta">
              Employer: <strong>${app.employer_name}</strong> · ${app.job_city} · ${app.job_type || 'Full-Time'}
              <br>Applied: ${new Date(app.created_at).toLocaleDateString('en-IN')}
            </div>
          </div>
          <div class="app-status ${app.status || 'pending'}">${app.status ? app.status.charAt(0).toUpperCase() + app.status.slice(1) : 'Pending'}</div>
        </div>
        ${app.status_message ? `<div style="font-size:0.88rem;color:var(--text-mid);margin-top:8px">📝 ${app.status_message}</div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-outline btn-sm" onclick="toggleApplicationEdit('${app.application_id}')">✏️ Edit Message</button>
          <button class="btn btn-outline btn-sm" onclick="deleteApplication('${app.application_id}')">🗑 Delete</button>
        </div>
        <div id="appEditSection-${app.application_id}" style="display:none;margin-top:12px">
          <textarea id="appEditTextarea-${app.application_id}" rows="4" style="width:100%;padding:12px;border:1.5px solid #ddd;border-radius:10px;font-size:0.95rem;resize:vertical;">${app.message || ''}</textarea>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
            <button class="btn btn-primary btn-sm" onclick="saveApplicationMessage('${app.application_id}')">Save</button>
            <button class="btn btn-outline btn-sm" onclick="cancelApplicationEdit('${app.application_id}')">Cancel</button>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><p>' + err.message + '</p></div>';
  }
}

async function loadEmployerApplications() {
  const container = document.getElementById('applicationsList');
  if (!container) return;
  
  container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div>Loading applications...</div>';
  
  try {
    const applications = await fetchJson('/api/employer/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: currentUser.identifier
      })
    });
    
    if (applications.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📥</div><p>No applications received yet. Post a job to start receiving applications!</p></div>';
      return;
    }
    
    container.innerHTML = applications.map(app => `
      <div class="app-card">
        <div class="app-card-header">
          <div>
            <div class="app-card-title">${app.worker_name}</div>
            <div class="app-card-meta">
              Position: <strong>${app.job_title}</strong> · ${app.worker_role}
              <br>Location: ${app.worker_city} · Applied: ${new Date(app.created_at).toLocaleDateString('en-IN')}
              <br>📞 ${app.worker_phone} · 📧 ${app.worker_email}
            </div>
          </div>
          <div class="app-status ${app.status || 'pending'}">${app.status ? app.status.charAt(0).toUpperCase() + app.status.slice(1) : 'Pending'}</div>
        </div>
        ${app.message ? `<div style="font-size:0.88rem;color:var(--text-mid);margin-top:8px">📝 ${app.message}</div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-primary btn-sm" onclick="updateApplicationStatus('${app.application_id}', 'accepted')">✅ Accept</button>
          <button class="btn btn-outline btn-sm" onclick="updateApplicationStatus('${app.application_id}', 'rejected')">❌ Reject</button>
          <button class="btn btn-outline btn-sm" onclick="deleteApplication('${app.application_id}')">🗑 Delete</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><p>' + err.message + '</p></div>';
  }
}

async function loadWorkerOffers() {
  const container = document.getElementById('offersList');
  if (!container) return;
  
  container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div>Loading offers...</div>';
  
  try {
    const offers = await fetchJson('/api/worker/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: currentUser.identifier
      })
    });
    
    if (offers.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎁</div><p>You haven\'t received any offers yet. Keep applying to jobs!</p></div>';
      return;
    }
    
    container.innerHTML = offers.map(offer => `
      <div class="app-card">
        <div class="app-card-header">
          <div>
            <div class="app-card-title">${offer.employer_name}</div>
            <div class="app-card-meta">
              Type: ${offer.employer_type} · Location: ${offer.employer_city || 'N/A'}, ${offer.employer_state || 'N/A'}
              <br>📞 ${offer.employer_phone} · 📧 ${offer.employer_email}
              <br>Received: ${new Date(offer.created_at).toLocaleDateString('en-IN')}
            </div>
          </div>
          <div class="app-status ${offer.status || 'pending'}">${offer.status ? offer.status.charAt(0).toUpperCase() + offer.status.slice(1) : 'Pending'}</div>
        </div>
        ${offer.message ? `<div style="font-size:0.88rem;color:var(--text-mid);margin-top:8px">💬 ${offer.message}</div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-primary btn-sm" onclick="updateOfferStatus('${offer.offer_id}', 'accepted')">✅ Accept</button>
          <button class="btn btn-outline btn-sm" onclick="updateOfferStatus('${offer.offer_id}', 'rejected')">❌ Reject</button>
          <button class="btn btn-outline btn-sm" onclick="deleteOffer('${offer.offer_id}')">🗑 Delete</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><p>' + err.message + '</p></div>';
  }
}

async function loadEmployerOffers() {
  const container = document.getElementById('offersList');
  if (!container) return;
  
  container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div>Loading offers...</div>';
  
  try {
    const offers = await fetchJson('/api/employer/offers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: currentUser.identifier
      })
    });
    
    if (offers.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">🎁</div><p>You haven\'t sent any offers yet. Review applications to send offers!</p></div>';
      return;
    }
    
    container.innerHTML = offers.map(offer => `
      <div class="app-card">
        <div class="app-card-header">
          <div>
            <div class="app-card-title">${offer.worker_name}</div>
            <div class="app-card-meta">
              Role: ${offer.worker_role} · Location: ${offer.worker_city}
              <br>📞 ${offer.worker_phone} · 📧 ${offer.worker_email}
              <br>Sent: ${new Date(offer.created_at).toLocaleDateString('en-IN')}
            </div>
          </div>
          <div class="app-status ${offer.status || 'pending'}">${offer.status ? offer.status.charAt(0).toUpperCase() + offer.status.slice(1) : 'Pending'}</div>
        </div>
        ${offer.message ? `<div style="font-size:0.88rem;color:var(--text-mid);margin-top:8px">💬 ${offer.message}</div>` : ''}
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
          <button class="btn btn-outline btn-sm" onclick="toggleOfferEdit('${offer.offer_id}')">✏️ Edit Message</button>
          <button class="btn btn-outline btn-sm" onclick="deleteOffer('${offer.offer_id}')">🗑 Delete</button>
        </div>
        <div id="offerEditSection-${offer.offer_id}" style="display:none;margin-top:12px">
          <textarea id="offerEditTextarea-${offer.offer_id}" rows="4" style="width:100%;padding:12px;border:1.5px solid #ddd;border-radius:10px;font-size:0.95rem;resize:vertical;">${offer.message || ''}</textarea>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px">
            <button class="btn btn-primary btn-sm" onclick="saveOfferMessage('${offer.offer_id}')">Save</button>
            <button class="btn btn-outline btn-sm" onclick="cancelOfferEdit('${offer.offer_id}')">Cancel</button>
          </div>
        </div>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><p>' + err.message + '</p></div>';
  }
}

function triggerPhotoUpload() {
  let input = document.getElementById('photoInput');
  if (!input) {
    input = document.createElement('input');
    input.id = 'photoInput';
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    input.addEventListener('change', handlePhotoUpload);
    document.body.appendChild(input);
  }
  input.click();
}

async function handlePhotoUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = async (event) => {
    const photoData = event.target.result;
    
    try {
      const result = await fetchJson('/api/upload-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: currentUser.identifier,
          role: currentUser.role,
          photo: photoData
        })
      });
      
      // Update the photo element
      const photoEl = document.getElementById('profilePhotoEl');
      if (photoEl && result.photo_url) {
        photoEl.style.backgroundImage = `url(${result.photo_url})`;
        photoEl.style.backgroundSize = 'cover';
        photoEl.style.backgroundPosition = 'center';
        photoEl.textContent = '';
      }
      
      toast('✅ Photo uploaded successfully!');
    } catch (err) {
      toast(err.message, true);
    }
    
    // Reset input
    e.target.value = '';
  };
  
  reader.readAsDataURL(file);
}

let postsFilterRole = 'all';
let allPosts = [];
let userPosts = [];
let postUsers = {};

async function loadPostsFeed() {
  const container = document.getElementById('postsFeedContainer');
  if (!container) return;
  
  container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">⏳</div>Loading posts...</div>';
  
  try {
    // Fetch all posts with user authentication info
    const params = new URLSearchParams();
    if (currentUser?.identifier) params.set('identifier', currentUser.identifier);
    if (currentUser?.role) params.set('role', currentUser.role);
    
    const posts = await fetchJson(`/api/posts/all?${params.toString()}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    allPosts = posts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    
    // Extract unique users for sidebar
    const usersMap = {};
    const userPostCounts = {};
    
    for (const post of allPosts) {
      const userId = post.owner_id;
      userPostCounts[userId] = (userPostCounts[userId] || 0) + 1;
      
      if (!usersMap[userId]) {
        usersMap[userId] = {
          id: userId,
          name: post.owner_name,
          role: post.owner_role,
          icon: post.owner_icon,
          photo_url: post.owner_photo,
          identifier: post.owner_identifier
        };
      }
    }
    
    postUsers = usersMap;
    
    // Render posts with filter
    postsFilterRole = 'all';
    renderPostsFeed(allPosts);
    
  } catch (err) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">❌</div><p>' + err.message + '</p></div>';
  }
}

function filterPostsByRole(role) {
  postsFilterRole = role;
  
  // Update filter buttons
  document.querySelectorAll(`#page-posts .filter-chip`).forEach(btn => btn.classList.remove('active'));
  document.getElementById('filter-' + role).classList.add('active');
  
  // Filter and render posts
  const filtered = role === 'all' ? allPosts : allPosts.filter(p => p.owner_role === role);
  renderPostsFeed(filtered);
}

function renderPostsFeed(posts) {
  const container = document.getElementById('postsFeedContainer');
  if (!container) return;
  
  if (!posts || posts.length === 0) {
    container.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📝</div><p>No posts to display. Be the first to share your achievement!</p></div>';
    return;
  }
  
  container.innerHTML = posts.map(post => {
    const user = postUsers[post.owner_id] || {};
    const isWorker = post.owner_role === 'worker';
    const postTypeEmoji = post.post_type === 'achievement' ? '⭐' : 
                         post.post_type === 'skill' ? '💡' :
                         post.post_type === 'qualification' ? '🎓' :
                         post.post_type === 'share' ? '🔗' : '📝';
    
    const photoHtml = post.photo_url ? `<img src="${post.photo_url}" style="width:100%;max-height:400px;object-fit:cover;border-radius:var(--radius);margin:14px 0">` : '';
    
    // Avatar: show photo if available, otherwise icon
    const avatarContent = user.photo_url ? 
      `<img src="${user.photo_url}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">` : 
      (user.icon || (isWorker ? '👷' : '🏢'));
    
    // Get interaction data (will be loaded dynamically)
    const likeCount = post.like_count || 0;
    const commentCount = post.comment_count || 0;
    const shareCount = post.share_count || 0;
    const isLiked = post.user_liked || false;
    
    return `
      <div class="feed-post" data-post-id="${post.id}">
        <div class="feed-post-header">
          <div class="feed-avatar" onclick="viewUserProfile('${post.owner_id}', '${post.owner_role}')" style="cursor:pointer">
            ${avatarContent}
          </div>
          <div class="feed-user-info">
            <div class="feed-user-name" onclick="viewUserProfile('${post.owner_id}', '${post.owner_role}')" style="cursor:pointer;color:var(--accent);text-decoration:underline">
              ${user.name || 'Anonymous'}
            </div>
            <div class="feed-user-meta">
              <span class="feed-user-badge">${isWorker ? '👷 Worker' : '🏢 Employer'}</span>
              <span>${timeAgo(post.created_at)}</span>
            </div>
          </div>
        </div>
        
        <span class="feed-post-type">${postTypeEmoji} ${post.post_type || 'Post'}</span>
        
        ${post.title ? `<div class="feed-post-title">${post.title}</div>` : ''}
        <div class="feed-post-content">${post.content}</div>
        ${photoHtml}
        
        <div class="feed-post-time">Updated ${new Date(post.updated_at).toLocaleDateString('en-IN')}</div>
        
        <!-- Interaction Stats -->
        <div class="feed-post-stats">
          <span class="stat-item like-stat ${likeCount > 0 ? 'has-likes' : ''}" onclick="showLikes('${post.id}')">
            <span class="stat-icon">👍</span>
            <span class="stat-count">${likeCount}</span>
            <span class="stat-label">${likeCount === 1 ? 'Like' : 'Likes'}</span>
          </span>
          <span class="stat-item comment-stat ${commentCount > 0 ? 'has-comments' : ''}" onclick="showComments('${post.id}')">
            <span class="stat-icon">💬</span>
            <span class="stat-count">${commentCount}</span>
            <span class="stat-label">${commentCount === 1 ? 'Comment' : 'Comments'}</span>
          </span>
          <span class="stat-item share-stat ${shareCount > 0 ? 'has-shares' : ''}">
            <span class="stat-icon">🔗</span>
            <span class="stat-count">${shareCount}</span>
            <span class="stat-label">${shareCount === 1 ? 'Share' : 'Shares'}</span>
          </span>
        </div>
        
        <!-- Action Buttons -->
        <div class="feed-post-actions">
          <button class="feed-action-btn like-btn ${isLiked ? 'liked' : ''}" onclick="toggleLike('${post.id}')">
            <span class="action-icon">${isLiked ? '❤️' : '👍'}</span>
            <span class="action-text">${isLiked ? 'Liked' : 'Like'}</span>
          </button>
          <button class="feed-action-btn comment-btn" onclick="showComments('${post.id}')">
            <span class="action-icon">💬</span>
            <span class="action-text">Comment</span>
          </button>
          <button class="feed-action-btn share-btn" onclick="sharePost('${post.id}')">
            <span class="action-icon">🔗</span>
            <span class="action-text">Share</span>
          </button>
          ${currentUser?.profile?.id === post.owner_id ? `
            <button class="feed-action-btn edit-btn" onclick="editPost('${post.id}')">
              <span class="action-icon">✎</span>
              <span class="action-text">Edit</span>
            </button>
            <button class="feed-action-btn delete-btn" onclick="deletePost('${post.id}')" style="color:#c23d32">
              <span class="action-icon">🗑</span>
              <span class="action-text">Delete</span>
            </button>
          ` : ''}
        </div>
        
        <!-- Comments Section (hidden by default) -->
        <div class="comments-section" id="comments-${post.id}" style="display:none;">
          <div class="comments-list" id="comments-list-${post.id}">
            <!-- Comments will be loaded here -->
          </div>
          
          <!-- Add Comment Form -->
          <div class="add-comment-form">
            <div class="comment-input-container">
              <input type="text" class="comment-input" id="comment-input-${post.id}" 
                     placeholder="Write a comment..." maxlength="500">
              <button class="comment-submit-btn" onclick="addComment('${post.id}')">
                <span class="submit-icon">📤</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function timeAgo(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const seconds = Math.floor((now - date) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  if (seconds < 2592000) return `${Math.floor(seconds / 604800)}w ago`;
  return `${Math.floor(seconds / 2592000)}mo ago`;
}

function viewUserProfile(userId, role, identifier) {
  // Allow identifier to be passed directly from worker/job listings.
  let profileIdentifier = identifier;
  let profileId = userId;

  if (!profileIdentifier) {
    const user = postUsers[userId];
    profileIdentifier = user?.identifier;
  }

  if (!profileIdentifier) {
    // If the passed value looks like an identifier, use it directly.
    if (typeof userId === 'string' && (userId.includes('@') || /^[0-9]{7,}$/.test(userId))) {
      profileIdentifier = userId;
      profileId = null;
    }
  }

  if (!profileIdentifier) {
    toast('Unable to load user profile', true);
    return;
  }

  viewedUser = {
    id: profileId,
    role: role,
    identifier: profileIdentifier
  };
  showPage('profile');
}

function backToMyProfile() {
  viewedUser = null;
  renderProfile();
}

function toggleFeedCreatePostForm() {
  const form = document.getElementById('postsCreateFormContainer');
  if (form) form.style.display = form.style.display === 'none' ? 'block' : 'none';
  if (form) form.style.display = 'none';
}

function showFeedPostPhotoPreview() {
  const input = document.getElementById('feedPostPhoto');
  const preview = document.getElementById('feedPostPhotoPreview');
  const img = document.getElementById('feedPostPhotoImg');
  
  if (input.files && input.files[0]) {
    const reader = new FileReader();
    reader.onload = function(e) {
      img.src = e.target.result;
      preview.style.display = 'block';
    };
    reader.readAsDataURL(input.files[0]);
  }
}

function removeFeedPostPhoto() {
  const input = document.getElementById('feedPostPhoto');
  const preview = document.getElementById('feedPostPhotoPreview');
  input.value = '';
  preview.style.display = 'none';
}

async function doCreateFeedPost() {
  if (!currentUser) {
    toast('Please login to create a post', true);
    return;
  }
  
  const title = document.getElementById('feedPostTitle').value.trim();
  const content = document.getElementById('feedPostContent').value.trim();
  const postType = document.getElementById('feedPostType').value;
  const photoInput = document.getElementById('feedPostPhoto');
  
  if (!content) {
    toast('Please enter some content', true);
    return;
  }
  
  try {
    // First create the post
    const postData = await fetchJson('/api/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: currentUser.identifier,
        role: currentUser.role,
        title: title,
        content: content,
        post_type: postType
      })
    });
    
    // If there's a photo, upload it
    if (photoInput.files && photoInput.files[0]) {
      const file = photoInput.files[0];
      const reader = new FileReader();
      
      reader.onload = async (event) => {
        const photoData = event.target.result;
        try {
          await fetchJson('/api/posts/photo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              identifier: currentUser.identifier,
              role: currentUser.role,
              post_id: postData.post_id,
              photo: photoData
            })
          });
        } catch (err) {
          console.warn('Photo upload failed:', err);
        }
        
        // Clear form and reload
        document.getElementById('feedPostTitle').value = '';
        document.getElementById('feedPostContent').value = '';
        document.getElementById('feedPostType').value = 'achievement';
        removeFeedPostPhoto();
        toggleFeedCreatePostForm();
        
        toast('✅ Post created successfully!');
        loadPostsFeed();
      };
      
      reader.readAsDataURL(file);
    } else {
      // No photo, just clear form
      document.getElementById('feedPostTitle').value = '';
      document.getElementById('feedPostContent').value = '';
      document.getElementById('feedPostType').value = 'achievement';
      removeFeedPostPhoto();
      toggleFeedCreatePostForm();
      
      toast('✅ Post created successfully!');
      loadPostsFeed();
    }
    
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
        <button id="applyConfirmBtn" style="padding:10px 24px;background:var(--green,#2d7d46);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:0.95rem" onclick="doApplyJob('${jobId}')">Send Application ✉️</button>
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

window.addEventListener('DOMContentLoaded', () => {
  initApp().catch(() => {});
  const initialPage = location.hash.slice(1) || 'home';
  showPage(initialPage);
});
window.addEventListener('hashchange', () => {
  const nextPage = location.hash.slice(1) || 'home';
  showPage(nextPage, false);
});
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
window.triggerPhotoUpload = triggerPhotoUpload;
window.handlePhotoUpload = handlePhotoUpload;
window.toggleCreatePostForm = toggleCreatePostForm;
window.doCreatePost = doCreatePost;
window.loadUserPosts = loadUserPosts;
window.editPost = editPost;
window.deletePost = deletePost;
window.loadWorkerApplications = loadWorkerApplications;
window.loadEmployerApplications = loadEmployerApplications;
window.loadWorkerOffers = loadWorkerOffers;
window.loadEmployerOffers = loadEmployerOffers;
window.renderProfile = renderProfile;
window.loadPostsFeed = loadPostsFeed;
window.filterPostsByRole = filterPostsByRole;
window.renderPostsFeed = renderPostsFeed;
window.timeAgo = timeAgo;
window.viewUserProfile = viewUserProfile;
window.backToMyProfile = backToMyProfile;
window.toggleFeedCreatePostForm = toggleFeedCreatePostForm;
window.showFeedPostPhotoPreview = showFeedPostPhotoPreview;
window.removeFeedPostPhoto = removeFeedPostPhoto;
window.doCreateFeedPost = doCreateFeedPost;

// Old chatbot functions deprecated - replaced with enhanced version in skillmatch.html
// The new chatbot includes voice support and multilingual features