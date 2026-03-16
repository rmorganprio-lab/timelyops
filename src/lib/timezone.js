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
export function formatTime(timeStr) {
  if (!timeStr) return 'TBD'
  return timeStr.slice(0, 5)
}

/**
 * Format a UTC timestamp for display in the org's timezone
 * Used for things like arrived_at, completed_at which are stored as UTC timestamps
 */
export function formatTimestamp(isoString, timezone) {
  if (!isoString) return ''
  return new Date(isoString).toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
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
 * Common US timezones for the settings dropdown
 */
export const US_TIMEZONES = [
  { value: 'Pacific/Honolulu', label: 'Hawaii (HST)' },
  { value: 'America/Anchorage', label: 'Alaska (AKST)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PST/PDT)' },
  { value: 'America/Denver', label: 'Mountain (MST/MDT)' },
  { value: 'America/Chicago', label: 'Central (CST/CDT)' },
  { value: 'America/New_York', label: 'Eastern (EST/EDT)' },
]
