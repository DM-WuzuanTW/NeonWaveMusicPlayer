export const THEME_STORAGE_KEY = 'neonwave_theme'

export const THEMES = [
  {
    id: 'neonwave',
    name: 'NeonWave',
    description: '目前的經典霓虹外觀',
    colors: ['#00fff2', '#ff00ff', '#172554']
  },
  {
    id: 'spotify',
    name: 'Spotify 風格',
    description: '卡片式資料庫與底部播放 Dock',
    colors: ['#1ed760', '#1fdf64', '#121212']
  },
  {
    id: 'discord',
    name: 'Discord 風格',
    description: '緊密分欄與工具型控制列',
    colors: ['#5865f2', '#7983f5', '#1e1f22']
  },
  {
    id: 'youtube-music',
    name: 'YouTube Music 風格',
    description: '扁平寬版列表與精簡控制列',
    colors: ['#ff0033', '#ff4e68', '#090909']
  },
  {
    id: 'apple-music',
    name: 'Apple Music 風格',
    description: '寬鬆留白與浮動播放 Dock',
    colors: ['#fa2d55', '#a855f7', '#17171a']
  }
] as const

export type AppTheme = typeof THEMES[number]['id']

export function isAppTheme(value: string | null): value is AppTheme {
  return THEMES.some(theme => theme.id === value)
}

export function getStoredTheme(): AppTheme {
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY)
  return isAppTheme(storedTheme) ? storedTheme : 'neonwave'
}

export function applyTheme(theme: AppTheme, persist = true) {
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = 'dark'
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, theme)
}

export function initializeTheme() {
  applyTheme(getStoredTheme(), false)
  window.addEventListener('storage', event => {
    if (event.key === THEME_STORAGE_KEY && isAppTheme(event.newValue)) {
      applyTheme(event.newValue, false)
    }
  })
}
