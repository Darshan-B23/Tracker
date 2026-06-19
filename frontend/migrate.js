const fs = require('fs');
const path = require('path');

const newStyleBlock = `<style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800;900&family=JetBrains+Mono:wght@400;700;800&display=swap');

    /* =========================================
       1. LIGHT MODE VARIABLES (Raw Concrete)
       ========================================= */
    :root {
      --bg-base: #bcbcbc;       /* User specified light base */
      --bg-surface: #c8c8c8;    /* Slightly lighter for inputs/cards */
      --text-main: #1a1a1a;     /* Deep contrast text */
      --text-muted: #5a5a5a;    /* Mid-grey for secondary text */
      --border-main: #1a1a1a;   /* Harsh borders */
      --border-muted: #8a8a8a;  /* Subtle borders */
      --shadow-color: #1a1a1a;  /* Solid shadow */
      
      /* Pigments (Consistent across both modes) */
      --pigment-yellow: #c8a97e;
      --pigment-red: #c26e60;
      --pigment-purple: #8d7a8b;
      --pigment-blue: #6e8ca0;
    }

    /* =========================================
       2. DARK MODE VARIABLES (Matte Graphite)
       ========================================= */
    .dark {
      --bg-base: #383838;       /* User specified dark base */
      --bg-surface: #454545;    /* Slightly lighter for inputs/cards */
      --text-main: #ececec;     /* Crisp off-white text */
      --text-muted: #a3a3a3;    /* Mid-light grey for secondary */
      --border-main: #ececec;   /* Harsh light borders */
      --border-muted: #686868;  /* Subtle borders */
      --shadow-color: #111111;  /* Deep shadow to stand out against #383838 */
    }

    body {
      font-family: 'Inter', sans-serif;
      background-color: var(--bg-base);
      color: var(--text-main);
      transition: background-color 0.3s ease, color 0.3s ease;
    }

    .font-mono { font-family: 'JetBrains Mono', monospace; }

    /* =========================================
       3. COMPONENT STYLES (Variable-Driven)
       ========================================= */
    .brutal-block {
      border: 2px solid var(--border-main);
      background-color: var(--bg-base);
    }

    .brutal-interactive {
      border: 2px solid var(--border-main);
      background-color: var(--bg-base);
      transition: all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1);
    }
    .brutal-interactive:hover {
      transform: translate(-4px, -4px);
      box-shadow: 4px 4px 0px 0px var(--shadow-color);
      background-color: var(--bg-surface); 
    }

    .brutal-input {
      width: 100%;
      border: 2px solid var(--border-muted);
      background-color: var(--bg-surface);
      color: var(--text-main);
      padding: 0.75rem 1rem;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      outline: none;
      transition: all 0.2s;
    }
    .brutal-input:focus {
      border-color: var(--border-main);
      background-color: var(--bg-base);
    }
    .brutal-input::placeholder {
      color: var(--text-muted);
    }

    /* =========================================
       4. DYNAMIC SVG ARROWS FOR SELECTS
       ========================================= */
    /* Light mode arrow (#1a1a1a) */
    select.brutal-input {
      appearance: none;
      background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%231a1a1a%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
      background-repeat: no-repeat;
      background-position: right 1rem top 50%;
      background-size: 0.65rem auto;
      cursor: pointer;
    }
    /* Dark mode arrow (#ececec) */
    .dark select.brutal-input {
      background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23ececec%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
    }
  </style>`;

const htmlFiles = fs.readdirSync(__dirname).filter(f => f.endsWith('.html'));

const replacements = [
  // 1. Structural replacements first (important for selection logic)
  { regex: /selection:bg-\[#e8eceb\]/g, target: 'selection:bg-[var(--border-main)] selection:text-[var(--bg-base)]' },

  // Backgrounds
  { regex: /bg-white/g, target: 'bg-[var(--bg-base)]' },
  { regex: /bg-\[#ffffff\]/g, target: 'bg-[var(--bg-base)]' },
  { regex: /bg-\[#f9fafb\]/g, target: 'bg-[var(--bg-surface)]' },
  { regex: /bg-\[#31353c\]/g, target: 'bg-[var(--text-main)]' },
  { regex: /bg-\[#e8eceb\]/g, target: 'bg-[var(--border-muted)]' },
  
  // Hover Backgrounds
  { regex: /hover:bg-white/g, target: 'hover:bg-[var(--bg-base)]' },
  { regex: /hover:bg-\[#ffffff\]/g, target: 'hover:bg-[var(--bg-base)]' },
  { regex: /hover:bg-\[#f9fafb\]/g, target: 'hover:bg-[var(--bg-surface)]' },
  { regex: /hover:bg-\[#31353c\]/g, target: 'hover:bg-[var(--text-main)]' },
  { regex: /hover:bg-\[#e8eceb\]/g, target: 'hover:bg-[var(--border-muted)]' },
  
  // Text
  { regex: /text-white/g, target: 'text-[var(--bg-base)]' },
  { regex: /text-\[#ffffff\]/g, target: 'text-[var(--bg-base)]' },
  { regex: /text-\[#31353c\]/g, target: 'text-[var(--text-main)]' },
  { regex: /text-\[#9ca3af\]/g, target: 'text-[var(--text-muted)]' },
  
  // Hover Text
  { regex: /hover:text-white/g, target: 'hover:text-[var(--bg-base)]' },
  { regex: /hover:text-\[#ffffff\]/g, target: 'hover:text-[var(--bg-base)]' },
  { regex: /hover:text-\[#31353c\]/g, target: 'hover:text-[var(--text-main)]' },
  { regex: /hover:text-\[#9ca3af\]/g, target: 'hover:text-[var(--text-muted)]' },

  // Borders
  { regex: /border-white/g, target: 'border-[var(--bg-base)]' },
  { regex: /border-\[#ffffff\]/g, target: 'border-[var(--bg-base)]' },
  { regex: /border-\[#31353c\]/g, target: 'border-[var(--border-main)]' },
  { regex: /border-\[#e8eceb\]/g, target: 'border-[var(--border-muted)]' },
  
  // Hover Borders
  { regex: /hover:border-white/g, target: 'hover:border-[var(--bg-base)]' },
  { regex: /hover:border-\[#ffffff\]/g, target: 'hover:border-[var(--bg-base)]' },
  { regex: /hover:border-\[#31353c\]/g, target: 'hover:border-[var(--border-main)]' },
  { regex: /hover:border-\[#e8eceb\]/g, target: 'hover:border-[var(--border-muted)]' },

  // Shadows
  { regex: /shadow-\[4px_4px_0px_0px_#31353c\]/g, target: 'shadow-[4px_4px_0px_0px_var(--shadow-color)]' },
  { regex: /shadow-\[2px_2px_0px_0px_#31353c\]/g, target: 'shadow-[2px_2px_0px_0px_var(--shadow-color)]' },

  // Pigment colors
  { regex: /bg-\[#c26e60\]/g, target: 'bg-[var(--pigment-red)]' },
  { regex: /text-\[#c26e60\]/g, target: 'text-[var(--pigment-red)]' },
  { regex: /border-\[#c26e60\]/g, target: 'border-[var(--pigment-red)]' },

  { regex: /bg-\[#c8a97e\]/g, target: 'bg-[var(--pigment-yellow)]' },
  { regex: /text-\[#c8a97e\]/g, target: 'text-[var(--pigment-yellow)]' },
  { regex: /border-\[#c8a97e\]/g, target: 'border-[var(--pigment-yellow)]' },

  { regex: /bg-\[#8d7a8b\]/g, target: 'bg-[var(--pigment-purple)]' },
  { regex: /text-\[#8d7a8b\]/g, target: 'text-[var(--pigment-purple)]' },
  { regex: /border-\[#8d7a8b\]/g, target: 'border-[var(--pigment-purple)]' },

  { regex: /bg-\[#6e8ca0\]/g, target: 'bg-[var(--pigment-blue)]' },
  { regex: /text-\[#6e8ca0\]/g, target: 'text-[var(--pigment-blue)]' },
  { regex: /border-\[#6e8ca0\]/g, target: 'border-[var(--pigment-blue)]' },
  
  // Specific replacements for the menu button:
  {
    regex: /<button class="p-2 flex items-center justify-center text-\[#31353c\] hover:bg-\[#31353c\] hover:text-white transition-colors border-2 border-\[#31353c\] bg-white cursor-pointer" aria-label="Menu">/g,
    target: `<div class="flex items-center gap-2">
          <button onclick="toggleTheme()" class="p-2 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer" aria-label="Toggle Theme">
            <i data-lucide="moon" class="w-4 h-4 theme-icon"></i>
          </button>
          <button class="p-2 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer" aria-label="Menu">`
  },
  {
    regex: /<button class="p-2 flex items-center justify-center text-\[var\(--text-main\)\] hover:bg-\[var\(--text-main\)\] hover:text-\[var\(--bg-base\)\] transition-colors border-2 border-\[var\(--border-main\)\] bg-\[var\(--bg-base\)\] cursor-pointer" aria-label="Menu">/g,
    target: `<div class="flex items-center gap-2">
          <button onclick="toggleTheme()" class="p-2 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer" aria-label="Toggle Theme">
            <i data-lucide="moon" class="w-4 h-4 theme-icon"></i>
          </button>
          <button class="p-2 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer" aria-label="Menu">`
  }
];

for (let file of htmlFiles) {
  let content = fs.readFileSync(path.join(__dirname, file), 'utf-8');
  
  // Replace <style> block
  content = content.replace(/<style>[\s\S]*?<\/style>/, newStyleBlock);
  
  // Replace html tag
  content = content.replace(/<html lang="en">/, '<html lang="en" class="light">');

  // Replace menu button closing tag to include the closing </div> for the gap-2 flex container
  // Wait, the menu button original HTML was:
  // <button ...>
  //   <i data-lucide="menu" class="w-4 h-4"></i>
  // </button>
  // We opened a <div class="flex items-center gap-2"> and need to close it after the button closes.
  content = content.replace(/<button class="p-2 flex items-center justify-center text-\[#31353c\] hover:bg-\[#31353c\] hover:text-white transition-colors border-2 border-\[#31353c\] bg-white cursor-pointer" aria-label="Menu">\s*<i data-lucide="menu" class="w-4 h-4"><\/i>\s*<\/button>/g, 
  `<div class="flex items-center gap-2">
          <button onclick="toggleTheme()" class="p-2 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer" aria-label="Toggle Theme">
            <i data-lucide="moon" class="w-4 h-4 theme-icon"></i>
          </button>
          <button class="p-2 text-[var(--text-muted)] hover:text-[var(--text-main)] transition-colors cursor-pointer" aria-label="Menu">
            <i data-lucide="menu" class="w-4 h-4"></i>
          </button>
        </div>`);

  // Apply other replacements
  for (let rule of replacements) {
    if (rule.regex.source.includes('button')) continue; // Skip the old rules we just handled perfectly
    content = content.replace(rule.regex, rule.target);
  }

  fs.writeFileSync(path.join(__dirname, file), content);
  console.log(`Migrated ${file}`);
}
