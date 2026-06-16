// Shared JS functionality for HBT-2 Vanilla Architecture

window.HBT_SETTINGS = null;

// Initialize the application
async function initApp() {
  await loadSettings();
  injectSidebar();
  injectGlobalSearch();
}

// Fetch settings from the backend
async function loadSettings() {
  try {
    const res = await fetch('http://localhost:3000/api/settings');
    if (res.ok) {
      window.HBT_SETTINGS = await res.json();
    }
  } catch (e) {
    console.error('Failed to load settings', e);
  }
}

// Format Date Utility
function formatDate(dateString, format) {
  if (!dateString) return '';
  const d = new Date(dateString);
  if (isNaN(d.getTime())) return '';

  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();

  const activeFormat = format || (window.HBT_SETTINGS ? window.HBT_SETTINGS.date_format : 'DD/MM/YYYY');

  if (activeFormat === 'MM/DD/YYYY') return `${mm}/${dd}/${yyyy}`;
  if (activeFormat === 'YYYY-MM-DD') return `${yyyy}-${mm}-${dd}`;
  return `${dd}/${mm}/${yyyy}`; // Default
}

// Format Time Utility
function formatTime(timeString, format) {
  if (!timeString) return '';
  let h, m;
  if (timeString.includes('T')) {
    const d = new Date(timeString);
    if (isNaN(d.getTime())) return '';
    h = d.getHours();
    m = d.getMinutes();
  } else {
    const parts = timeString.split(':');
    if (parts.length < 2) return timeString;
    h = parseInt(parts[0], 10);
    m = parseInt(parts[1], 10);
  }

  const mm = String(m).padStart(2, '0');
  const activeFormat = format || (window.HBT_SETTINGS ? window.HBT_SETTINGS.time_format : '24 Hour');

  if (activeFormat === '12 Hour') {
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${mm} ${ampm}`;
  }
  
  return `${String(h).padStart(2, '0')}:${mm}`;
}

// Inject the Global Sidebar into the DOM
function injectSidebar() {
  const sidebarHtml = `
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>PERSONAL OS</h2>
      </div>
      <nav class="sidebar-nav">
        <ul>
          <li><a href="/dashboard.html">QUEUE</a></li>
          <li><a href="/skills.html">SKILLS</a></li>
          <li><a href="/projects.html">PROJECTS</a></li>
          <li><a href="/goals.html">GOALS</a></li>
        </ul>
        <div class="mt-8 mb-4">
          <h3 class="text-secondary text-xs font-bold tracking-widest uppercase px-4">Tracking</h3>
        </div>
        <ul>
          <li><a href="/health.html">HEALTH</a></li>
          <li><a href="/fitness.html">FITNESS</a></li>
          <li><a href="/analytics.html">ANALYTICS</a></li>
          <li><a href="/settings.html">SETTINGS</a></li>
        </ul>
      </nav>
    </aside>
  `;

  // Find the app container to prepend the sidebar
  const container = document.querySelector('.app-container');
  if (container) {
    container.insertAdjacentHTML('afterbegin', sidebarHtml);
    
    // Highlight active link
    const currentPath = window.location.pathname;
    const links = document.querySelectorAll('.sidebar-nav a');
    links.forEach(link => {
      if (link.getAttribute('href') === currentPath || (currentPath === '/' && link.getAttribute('href') === '/dashboard.html')) {
        link.classList.add('active');
      }
    });
  }
}

// Inject the Global Search component into the DOM
function injectGlobalSearch() {
  const searchHtml = `
    <div class="relative mb-8 z-50" id="global-search-wrapper">
      <input 
        type="text" 
        id="global-search-input"
        class="w-full bg-[var(--surface-color)] border border-[var(--border-color)] px-4 py-3 text-sm font-bold uppercase tracking-widest outline-none focus:border-[var(--text-primary)] transition-colors placeholder-[var(--text-secondary)]" 
        placeholder="[ SEARCH ANY ENTITY... ]"
        autocomplete="off"
      />
      <div id="global-search-results" class="absolute top-full left-0 right-0 bg-[var(--bg-color)] border border-t-0 border-[var(--border-color)] shadow-xl max-h-[60vh] overflow-y-auto hidden"></div>
    </div>
  `;

  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    mainContent.insertAdjacentHTML('afterbegin', searchHtml);

    const searchInput = document.getElementById('global-search-input');
    const searchResults = document.getElementById('global-search-results');
    const wrapper = document.getElementById('global-search-wrapper');

    let debounceTimer;

    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      const query = e.target.value.trim();
      
      if (!query) {
        searchResults.classList.add('hidden');
        searchResults.innerHTML = '';
        return;
      }

      debounceTimer = setTimeout(async () => {
        try {
          const res = await fetch(`http://localhost:3000/api/search?q=${encodeURIComponent(query)}`);
          if (res.ok) {
            const data = await res.json();
            renderSearchResults(data, searchResults, query);
          }
        } catch (err) {
          console.error('Search failed', err);
        }
      }, 300);
    });

    searchInput.addEventListener('focus', () => {
      if (searchInput.value.trim() && searchResults.innerHTML !== '') {
        searchResults.classList.remove('hidden');
      }
    });

    document.addEventListener('click', (e) => {
      if (wrapper && !wrapper.contains(e.target)) {
        searchResults.classList.add('hidden');
      }
    });
  }
}

function renderSearchResults(data, container, query) {
  const categories = ['goals', 'projects', 'skills', 'recipes', 'checklist_items'];
  let html = '';
  let hasResults = false;

  categories.forEach(category => {
    if (data[category] && data[category].length > 0) {
      hasResults = true;
      html += `
        <div class="mb-2">
          <div class="px-4 py-1 text-xs font-bold uppercase text-[var(--bg-color)] bg-[var(--text-primary)] tracking-widest">${category.replace('_', ' ')}</div>
      `;
      
      data[category].forEach(item => {
        const status = item.status || (item.completed ? 'Completed' : 'Pending');
        html += `
          <div 
            class="px-4 py-3 hover:bg-[var(--surface-color)] cursor-pointer border-b border-[var(--border-color)] last:border-0 flex justify-between"
            onclick="handleSearchSelect('${item.type}', ${item.id})"
          >
            <span class="font-medium text-sm">${item.name}</span>
            <span class="metadata text-[10px]">${status}</span>
          </div>
        `;
      });
      html += `</div>`;
    }
  });

  if (!hasResults) {
    html = `<div class="px-4 py-3 text-sm text-secondary">No results found.</div>`;
  }

  container.innerHTML = html;
  container.classList.remove('hidden');
}

function handleSearchSelect(type, id) {
  if (type === 'Skill') window.location.href = `/skills.html?id=${id}`;
  else if (type === 'Project') window.location.href = `/projects.html?id=${id}`;
  else if (type === 'Goal') window.location.href = `/goals.html?id=${id}`;
  else if (type === 'Recipe') window.location.href = `/health.html`;
  else if (type === 'Task') window.location.href = `/dashboard.html`;
}

// Run init on DOMContentLoaded
document.addEventListener('DOMContentLoaded', initApp);
