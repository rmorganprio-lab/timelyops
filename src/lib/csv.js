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

  const headers = parseLine(lines[0]).map(h =>
    h.trim()
     .replace(/\s*\*\s*$/, '')      // strip trailing " *" added by XLSX template for required fields
     .toLowerCase()
     .replace(/[^a-z0-9]+/g, '_')   // replace any run of non-alphanumeric chars (spaces, /, etc.) with _
     .replace(/^_+|_+$/g, '')       // trim leading/trailing underscores
  )
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
 * Download an XLSX template file with a Data sheet and Instructions sheet
 * @param {string} filename - e.g. "TOClientImportTemplate.xlsx"
 * @param {{ headers: string[], required: string[], sample: object, sample2?: object, instructions: string[][] }} templateDef
 */
export function downloadXLSXTemplate(filename, templateDef) {
  // Lazy import XLSX — must be installed as a dependency
  import('xlsx').then(XLSX => {
    const wb = XLSX.utils.book_new()

    // ── Data sheet ──
    const displayHeaders = templateDef.headers.map(h => {
      const label = h.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
      return templateDef.required.includes(h) ? `${label} *` : label
    })

    const dataRows = [displayHeaders]
    if (templateDef.rows && templateDef.rows.length > 0) {
      for (const row of templateDef.rows) dataRows.push(row)
    } else {
      if (templateDef.sample) {
        dataRows.push(templateDef.headers.map(h => templateDef.sample[h] ?? ''))
      }
      if (templateDef.sample2) {
        dataRows.push(templateDef.headers.map(h => templateDef.sample2[h] ?? ''))
      }
    }

    const dataSheet = XLSX.utils.aoa_to_sheet(dataRows)
    // Set column widths
    dataSheet['!cols'] = templateDef.headers.map(() => ({ wch: 18 }))
    XLSX.utils.book_append_sheet(wb, dataSheet, 'Data')

    // ── Instructions sheet ──
    const instrSheet = XLSX.utils.aoa_to_sheet(templateDef.instructions)
    instrSheet['!cols'] = [{ wch: 28 }, { wch: 14 }, { wch: 60 }]
    XLSX.utils.book_append_sheet(wb, instrSheet, 'Instructions')

    XLSX.writeFile(wb, filename)
  })
}

/**
 * Client template definition
 */
export const CLIENT_TEMPLATE = {
  headers: [
    'first_name', 'last_name', 'phone', 'email',
    'address_1', 'address_2', 'city', 'state_province', 'postal_code', 'country',
    'tags', 'notes',
    'property_type', 'bedrooms', 'bathrooms', 'square_footage',
    'pet_details', 'parking_instructions', 'alarm_code', 'key_info', 'supply_location', 'special_notes'
  ],
  required: ['first_name'],
  sample: {
    first_name: 'Jane',
    last_name: 'Smith',
    phone: '+16505550101',
    email: 'jane@email.com',
    address_1: '123 Main St',
    address_2: 'Apt 4B',
    city: 'San Jose',
    state_province: 'CA',
    postal_code: '95120',
    country: 'US',
    tags: 'weekly',
    notes: 'Prefers mornings',
    property_type: 'residential',
    bedrooms: '3',
    bathrooms: '2',
    square_footage: '1800',
    pet_details: '1 dog (friendly)',
    parking_instructions: 'Driveway, park on left',
    alarm_code: '1234',
    key_info: 'Under doormat',
    supply_location: 'Hall closet',
    special_notes: 'No shoes inside',
  },
  sample2: {
    first_name: 'Bob',
    last_name: 'Johnson',
    phone: '+14085550202',
    email: 'bob@email.com',
    address_1: '456 Oak Ave',
    address_2: '',
    city: 'Palo Alto',
    state_province: 'CA',
    postal_code: '94301',
    country: 'US',
    tags: 'biweekly',
    notes: 'Key lockbox',
    property_type: 'residential',
    bedrooms: '4',
    bathrooms: '3',
    square_footage: '2400',
    pet_details: '2 cats',
    parking_instructions: 'Street parking only',
    alarm_code: '',
    key_info: 'Lockbox code 5678',
    supply_location: 'Garage shelf',
    special_notes: 'Use green cleaning products',
  },
  instructions: [
    ['TimelyOps — Client Import Template', '', ''],
    ['', '', ''],
    ['Column', 'Required?', 'Description'],
    ['First Name', 'Yes *', 'Client\'s first name'],
    ['Last Name', 'No', 'Client\'s last name'],
    ['Phone', 'No', 'Phone number — E.164 format preferred (e.g. +16505551234) or US formats like (650) 555-1234'],
    ['Email', 'No', 'Client\'s email address'],
    ['Address 1', 'No', 'Street address line 1'],
    ['Address 2', 'No', 'Suite, apt, unit, etc.'],
    ['City', 'No', 'City'],
    ['State/Province', 'No', 'State or province abbreviation (e.g. CA)'],
    ['Postal Code', 'No', 'ZIP or postal code'],
    ['Country', 'No', 'Country code (e.g. US, CA) — defaults to your org setting'],
    ['Tags', 'No', 'Comma-separated tags (e.g. weekly, referral, vip)'],
    ['Notes', 'No', 'Internal notes about the client'],
    ['Property Type', 'No', 'residential, commercial, office, or other'],
    ['Bedrooms', 'No', 'Number of bedrooms'],
    ['Bathrooms', 'No', 'Number of bathrooms'],
    ['Square Footage', 'No', 'Property square footage'],
    ['Pet Details', 'No', 'Description of pets (e.g. 1 dog, friendly)'],
    ['Parking Instructions', 'No', 'Where to park'],
    ['Alarm Code', 'No', 'Security alarm code'],
    ['Key Info', 'No', 'Key or lockbox details'],
    ['Supply Location', 'No', 'Where cleaning supplies are kept'],
    ['Special Notes', 'No', 'Any other property-specific notes'],
    ['', '', ''],
    ['Notes', '', ''],
    ['- Columns marked * are required; all others are optional', '', ''],
    ['- Duplicate clients (matched by phone or email) will be skipped', '', ''],
    ['- Phone numbers will be normalised to E.164 on import', '', ''],
  ],
}

/**
 * Worker template definition
 */
export const WORKER_TEMPLATE = {
  headers: [
    'name', 'phone', 'email', 'role', 'availability',
    'address_1', 'address_2', 'city', 'state_province', 'postal_code', 'country'
  ],
  required: ['name'],
  sample: {
    name: 'Maria Garcia',
    phone: '+16505550301',
    email: 'maria@email.com',
    role: 'worker',
    availability: 'available',
    address_1: '789 Pine St',
    address_2: '',
    city: 'San Jose',
    state_province: 'CA',
    postal_code: '95125',
    country: 'US',
  },
  sample2: {
    name: 'James Lee',
    phone: '+14085550402',
    email: 'james@email.com',
    role: 'worker',
    availability: 'available',
    address_1: '321 Elm Dr',
    address_2: 'Unit 2',
    city: 'Santa Clara',
    state_province: 'CA',
    postal_code: '95050',
    country: 'US',
  },
  instructions: [
    ['TimelyOps — Worker Import Template', '', ''],
    ['', '', ''],
    ['Column', 'Required?', 'Description'],
    ['Name', 'Yes *', 'Worker\'s full name (first and last together, e.g. Maria Garcia)'],
    ['Phone', 'No', 'Phone number — E.164 format preferred (e.g. +16505551234) or US formats like (650) 555-1234'],
    ['Email', 'No', 'Worker\'s email address'],
    ['Role', 'No', 'worker, manager, or ceo — defaults to worker'],
    ['Availability', 'No', 'available or unavailable — defaults to available'],
    ['Address 1', 'No', 'Street address line 1'],
    ['Address 2', 'No', 'Suite, apt, unit, etc.'],
    ['City', 'No', 'City'],
    ['State/Province', 'No', 'State or province abbreviation (e.g. CA)'],
    ['Postal Code', 'No', 'ZIP or postal code'],
    ['Country', 'No', 'Country code (e.g. US, CA)'],
    ['', '', ''],
    ['Notes', '', ''],
    ['- Columns marked * are required; all others are optional', '', ''],
    ['- Name should be full name in a single column (not split into first/last)', '', ''],
    ['- Duplicate workers (matched by phone) will be skipped', '', ''],
    ['- Imported workers are created without login access; they must be invited separately', '', ''],
  ],
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
    if (!row.first_name) issues.push('First Name is required')
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
