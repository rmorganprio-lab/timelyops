/**
 * CSV Upload utility for AllBookd
 * Parses CSV files, validates data, and provides preview before import
 */

/**
 * Parse a CSV string into an array of objects
 * Handles quoted fields, commas inside quotes, and different line endings
 */
export function parseCSV(text) {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  if (lines.length < 2) return { headers: [], rows: [], errors: ['File is empty or has no data rows'] }

  const headers = parseLine(lines[0]).map(h => h.trim().toLowerCase().replace(/\s+/g, '_'))
  const rows = []
  const errors = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue // skip empty lines

    const values = parseLine(line)
    if (values.length !== headers.length) {
      errors.push(`Row ${i}: expected ${headers.length} columns, got ${values.length}`)
      continue
    }

    const row = {}
    headers.forEach((h, idx) => {
      row[h] = values[idx]?.trim() || ''
    })
    row._row = i
    rows.push(row)
  }

  return { headers, rows, errors }
}

/**
 * Parse a single CSV line handling quoted fields
 */
function parseLine(line) {
  const result = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else if (ch === '"') {
        inQuotes = false
      } else {
        current += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        result.push(current)
        current = ''
      } else {
        current += ch
      }
    }
  }
  result.push(current)
  return result
}

/**
 * Generate a CSV string from headers and sample data
 */
export function generateTemplate(headers, sampleRow = null) {
  let csv = headers.join(',') + '\n'
  if (sampleRow) {
    csv += headers.map(h => {
      const val = sampleRow[h] || ''
      return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val
    }).join(',') + '\n'
  }
  return csv
}

/**
 * Trigger download of a CSV file
 */
export function downloadCSV(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Client template definition
 */
export const CLIENT_TEMPLATE = {
  headers: [
    'name', 'phone', 'email', 'address', 'status', 'preferred_contact', 'tags', 'notes',
    'property_type', 'bedrooms', 'bathrooms', 'square_footage',
    'alarm_code', 'key_lockbox', 'pet_details', 'parking', 'supplies_location', 'special_notes'
  ],
  required: ['name'],
  sample: {
    name: 'Jane Smith',
    phone: '(650) 555-1234',
    email: 'jane@email.com',
    address: '123 Main St, San Jose, CA 95123',
    status: 'active',
    preferred_contact: 'email',
    tags: 'weekly, referral',
    notes: 'Prefers morning appointments',
    property_type: 'residential',
    bedrooms: '3',
    bathrooms: '2',
    square_footage: '1800',
    alarm_code: '1234',
    key_lockbox: 'Lockbox on back gate, code 5678',
    pet_details: '1 small dog, friendly',
    parking: 'Driveway',
    supplies_location: 'Hall closet',
    special_notes: 'Remove shoes at door',
  },
}

/**
 * Worker template definition
 */
export const WORKER_TEMPLATE = {
  headers: ['name', 'phone', 'email', 'role', 'skills'],
  required: ['name'],
  sample: {
    name: 'Maria Garcia',
    phone: '(650) 555-5678',
    email: 'maria@email.com',
    role: 'worker',
    skills: 'deep clean, move-in/move-out',
  },
}

/**
 * Normalize phone number to E.164 format for US numbers
 * Accepts: (650) 555-1234, 650-555-1234, 6505551234, +16505551234
 */
export function normalizePhone(phone) {
  if (!phone) return ''
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (phone.startsWith('+')) return phone
  return phone // return as-is if we can't normalize
}

/**
 * Validate client rows
 */
export function validateClientRows(rows) {
  return rows.map(row => {
    const issues = []
    if (!row.name) issues.push('Name is required')
    if (row.status && !['active', 'inactive', 'vip'].includes(row.status.toLowerCase())) {
      issues.push('Status must be active, inactive, or vip')
    }
    if (row.bedrooms && isNaN(Number(row.bedrooms))) issues.push('Bedrooms must be a number')
    if (row.bathrooms && isNaN(Number(row.bathrooms))) issues.push('Bathrooms must be a number')
    if (row.property_type && !['residential', 'commercial', 'office', 'other'].includes(row.property_type.toLowerCase())) {
      issues.push('Property type must be residential, commercial, office, or other')
    }
    return { ...row, _issues: issues, _valid: issues.length === 0 }
  })
}

/**
 * Validate worker rows
 */
export function validateWorkerRows(rows) {
  return rows.map(row => {
    const issues = []
    if (!row.name) issues.push('Name is required')
    if (row.role && !['ceo', 'manager', 'worker'].includes(row.role.toLowerCase())) {
      issues.push('Role must be ceo, manager, or worker')
    }
    return { ...row, _issues: issues, _valid: issues.length === 0 }
  })
}
