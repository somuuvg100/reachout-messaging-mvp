const modal = document.querySelector('#register-modal');
const result = document.querySelector('#form-result');
const message = document.querySelector('#message');
const count = document.querySelector('#character-count');
const historyList = document.querySelector('#history-list');
const historyEmpty = document.querySelector('#history-empty');
const API = '/api';
let authToken = localStorage.getItem('reachout_token');
fetch(`${API}/config`).then(response => response.json()).then(config => { if (config.sender && config.sender !== 'ReachOut verified number') document.querySelector('#sender').innerHTML = `<option value="${config.sender}">ReachOut · ${config.sender}</option>`; if (config.provider === 'twilio') { document.querySelector('#send-button').innerHTML = 'Send SMS <span>→</span>'; document.querySelector('#send-note').textContent = 'Live mode — your verified provider will deliver this SMS.'; } }).catch(() => {});

function openRegister() { modal.classList.remove('hidden'); document.querySelector('#name').focus(); }
function closeRegister() { modal.classList.add('hidden'); }

document.querySelector('#open-register').addEventListener('click', openRegister);
document.querySelector('#start-messaging').addEventListener('click', () => document.querySelector('#messaging').scrollIntoView());
document.querySelector('#close-register').addEventListener('click', closeRegister);
modal.addEventListener('click', event => { if (event.target === modal) closeRegister(); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeRegister(); });

message.addEventListener('input', () => { count.textContent = `${message.value.length} / 160`; });
document.querySelector('#message-form').addEventListener('submit', event => {
  event.preventDefault();
  const phone = document.querySelector('#phone').value.trim();
  const sender = document.querySelector('#sender').value;
  const payload = { phone, sender, message: message.value, countryCode: document.querySelector('#country').value, consent: document.querySelector('#consent').checked };
  fetch(`${API}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}) }, body: JSON.stringify(payload) })
    .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to send.'); return data; })
    .then(data => { result.textContent = `Demo message ready for ${data.message.recipient} from ${sender}. No SMS was sent.`; addHistory(data.message); event.target.reset(); count.textContent = '0 / 160'; })
    .catch(error => { result.textContent = error.message; });
});

function addHistory(item) { historyEmpty.style.display = 'none'; const entry = document.createElement('div'); entry.className = 'history-entry'; entry.innerHTML = `<span>${item.recipient} · ${item.body.slice(0, 30)}${item.body.length > 30 ? '…' : ''}</span><span>${item.status}</span>`; historyList.prepend(entry); }

const sendTab = document.querySelector('#send-tab');
const inboxTab = document.querySelector('#inbox-tab');
const inboxPanel = document.querySelector('#inbox-panel');
sendTab.addEventListener('click', () => { document.querySelector('#message-form').classList.remove('hidden'); inboxPanel.classList.add('hidden'); sendTab.classList.add('active'); inboxTab.classList.remove('active'); sendTab.setAttribute('aria-selected', 'true'); inboxTab.setAttribute('aria-selected', 'false'); });
inboxTab.addEventListener('click', () => { document.querySelector('#message-form').classList.add('hidden'); inboxPanel.classList.remove('hidden'); inboxTab.classList.add('active'); sendTab.classList.remove('active'); inboxTab.setAttribute('aria-selected', 'true'); sendTab.setAttribute('aria-selected', 'false'); loadInbox(); });
document.querySelector('#refresh-inbox').addEventListener('click', event => { event.target.textContent = 'Updated'; setTimeout(() => { event.target.textContent = 'Refresh'; }, 900); });

function loadInbox() { if (!authToken) return; fetch(`${API}/inbox`, { headers: { Authorization: `Bearer ${authToken}` } }).then(response => { if (response.status === 401) { authToken = null; localStorage.removeItem('reachout_token'); return null; } return response.json(); }).then(data => { if (!data?.messages?.length) return; const list = document.querySelector('#inbox-panel'); list.querySelectorAll('.inbox-message.dynamic').forEach(item => item.remove()); data.messages.forEach(item => { const article = document.createElement('article'); article.className = 'inbox-message dynamic'; article.innerHTML = `<div class="avatar small-avatar">↩</div><div><strong>Reply</strong><small>${item.sender} · ${new Date(item.createdAt).toLocaleString()}</small><p>${item.body}</p></div>`; list.insertBefore(article, list.querySelector('.inbox-note')); }); }).catch(() => {}); }
setInterval(loadInbox, 10000);

let accountMode = 'register';
document.querySelector('#account-switch').addEventListener('click', () => { accountMode = accountMode === 'register' ? 'login' : 'register'; document.querySelector('#register-modal h2').textContent = accountMode === 'register' ? 'Create your account' : 'Sign in'; document.querySelector('#name-field').classList.toggle('hidden', accountMode === 'login'); document.querySelector('#consent-field').classList.toggle('hidden', accountMode === 'login'); document.querySelector('#name').required = accountMode === 'register'; document.querySelector('#consent-field input').required = accountMode === 'register'; document.querySelector('#account-submit').textContent = accountMode === 'register' ? 'Create account' : 'Sign in'; document.querySelector('#account-switch').textContent = accountMode === 'register' ? 'Already have an account? Sign in' : 'Need an account? Create one'; document.querySelector('#register-result').textContent = ''; });
document.querySelector('#register-form').addEventListener('submit', event => {
  event.preventDefault();
  const registerResult = document.querySelector('#register-result');
  const endpoint = accountMode === 'register' ? 'register' : 'login';
  fetch(`${API}/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: document.querySelector('#name').value, email: document.querySelector('#email').value, password: document.querySelector('#password').value }) })
    .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to create account.'); return data; })
    .then(data => { authToken = data.token; localStorage.setItem('reachout_token', authToken); registerResult.textContent = `Welcome, ${data.user.name}. Your account is ready.`; setTimeout(closeRegister, 1200); })
    .catch(error => { registerResult.textContent = error.message; });
});
