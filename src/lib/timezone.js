/**
 * Timezone utility for AllBookd
 * 
 * All dates and times in the app are in the ORGANIZATION's timezone.
 * This module ensures consistent behavior regardless of where the user's browser is.
 * 
 * Key principle: Jobs happen at a physical location. "9:00 AM" means 9:00 AM
 * where the business operates, not where the viewer is sitting.
 */

/**
 * Get "now" in the organization's timezone as a Date-like object
 * Returns a Date object adjusted so that .getHours(), .getDate() etc. 
 * return values in the org's local time
 */
export function nowInTimezone(timezone) {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const get = (type) => parts.find(p => p.type === type)?.value
  
  return new Date(
    Number(get('year')),
    Number(get('month')) - 1,
    Number(get('day')),
    Number(get('hour')),
    Number(get('minute')),
    Number(get('second'))
  )
}

/**
 * Get today's date string (YYYY-MM-DD) in the org's timezone
 */
export function todayInTimezone(timezone) {
  return toDateStr(nowInTimezone(timezone))
}

/**
 * Convert a Date object to YYYY-MM-DD string using local values (no UTC shift)
 */
export function toDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Get current time string (HH:MM) in the org's timezone
 */
export function currentTimeInTimezone(timezone) {
  const now = nowInTimezone(timezone)
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/**
 * Format a date string (YYYY-MM-DD) for display
 * Uses T12:00:00 to avoid date shifting when parsing
 */
export function formatDate(dateStr, options = {}) {
  if (!dateStr) return ''
  const defaults = { month: 'short', day: 'numeric', year: 'numeric' }
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { ...defaults, ...options })
}

/**
 * Format a date string as full display (e.g. "Saturday, March 14, 2026")
 */
export function formatDateFull(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  })
}

/**
 * Format a time string (HH:MM or HH:MM:SS) for display
 */
export function formatTime(timeStr, format = '12h') {
  if (!timeStr) return 'TBD'
  const [hours, minutes] = timeStr.slice(0, 5).split(':').map(Number)
  if (format === '24h') {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  }
  const period = hours >= 12 ? 'PM' : 'AM'
  const h = hours % 12 || 12
  return `${h}:${String(minutes).padStart(2, '0')} ${period}`
}

/**
 * Format a UTC timestamp for display in the org's timezone
 * Used for things like arrived_at, completed_at which are stored as UTC timestamps
 */
export function formatTimestamp(isoString, timezone, format = '12h') {
  if (!isoString) return ''
  return new Date(isoString).toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: format === '12h',
  })
}

/**
 * Get the current hour in the org's timezone (for greeting)
 */
export function currentHourInTimezone(timezone) {
  return nowInTimezone(timezone).getHours()
}

/**
 * Get the timezone abbreviation for display (e.g. "PST", "PDT", "EST")
 */
export function getTimezoneAbbr(timezone) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'short',
  })
  const parts = formatter.formatToParts(new Date())
  return parts.find(p => p.type === 'timeZoneName')?.value || timezone
}

/**
 * Get a friendly timezone label (e.g. "Pacific Time (PST)")
 */
export function getTimezoneLabel(timezone) {
  const abbr = getTimezoneAbbr(timezone)
  const labels = {
    'America/Los_Angeles': 'Pacific Time',
    'America/Denver': 'Mountain Time',
    'America/Chicago': 'Central Time',
    'America/New_York': 'Eastern Time',
    'America/Anchorage': 'Alaska Time',
    'Pacific/Honolulu': 'Hawaii Time',
  }
  const name = labels[timezone] || timezone
  return `${name} (${abbr})`
}

/**
 * Get end-of-week date from a start date
 */
export function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return toDateStr(d)
}

/**
 * Common timezones for the settings dropdown
 */
export const US_TIMEZONES = [
  { value: 'Pacific/Honolulu',      label: 'Hawaii (HST/HDT)',         group: 'Americas' },
  { value: 'America/Anchorage',     label: 'Alaska (AKST/AKDT)',       group: 'Americas' },
  { value: 'America/Los_Angeles',   label: 'Pacific (PST/PDT)',        group: 'Americas' },
  { value: 'America/Denver',        label: 'Mountain (MST/MDT)',       group: 'Americas' },
  { value: 'America/Chicago',       label: 'Central (CST/CDT)',        group: 'Americas' },
  { value: 'America/New_York',      label: 'Eastern (EST/EDT)',        group: 'Americas' },
  { value: 'America/Sao_Paulo',     label: 'São Paulo (BRT/BRST)',     group: 'Americas' },
  { value: 'Europe/London',         label: 'London (GMT/BST)',         group: 'Europe' },
  { value: 'Europe/Amsterdam',      label: 'Amsterdam (CET/CEST)',     group: 'Europe' },
  { value: 'Europe/Paris',          label: 'Paris (CET/CEST)',         group: 'Europe' },
  { value: 'Europe/Berlin',         label: 'Berlin (CET/CEST)',        group: 'Europe' },
  { value: 'Europe/Madrid',         label: 'Madrid (CET/CEST)',        group: 'Europe' },
  { value: 'Europe/Helsinki',       label: 'Helsinki (EET/EEST)',      group: 'Europe' },
  { value: 'Asia/Dubai',            label: 'Dubai (GST)',              group: 'Asia / Pacific' },
  { value: 'Asia/Singapore',        label: 'Singapore (SGT)',          group: 'Asia / Pacific' },
  { value: 'Asia/Tokyo',            label: 'Tokyo (JST)',              group: 'Asia / Pacific' },
  { value: 'Asia/Sydney',           label: 'Sydney (AEST/AEDT)',       group: 'Asia / Pacific' },
  { value: 'Pacific/Auckland',      label: 'Auckland (NZST/NZDT)',     group: 'Asia / Pacific' },
]
