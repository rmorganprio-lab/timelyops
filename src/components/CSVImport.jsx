import { useState, useRef } from 'react'
import { parseCSV, downloadCSV, generateTemplate, normalizePhone } from '../lib/csv'

/**
 * CSVImport - Reusable modal for importing CSV data
 * 
 * Props:
 *   onClose - close the modal
 *   onImport - async (validRows) => { insert into supabase, return { success, count, errors } }
 *   templateDef - { headers, required, sample } from csv.js
 *   validateRows - (rows) => rows with _issues and _valid added
 *   entityName - "clients" or "workers" for display
 */
export default function CSVImport({ onClose, onImport, templateDef, validateRows, entityName }) {
  const [step, setStep] = useState('upload') // upload | preview | importing | done
  const [rows, setRows] = useState([])
  const [parseErrors, setParseErrors] = useState([])
  const [importResult, setImportResult] = useState(null)
  const fileRef = useRef()

  const validRows = rows.filter(r => r._valid)
  const invalidRows = rows.filter(r => !r._valid)

  function handleDownloadTemplate() {
    const csv = generateTemplate(templateDef.headers, templateDef.sample)
    downloadCSV(`allbookd-${entityName}-template.csv`, csv)
  }

  function handleFileSelect(e) {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (evt) => {
      const text = evt.target.result
      const { headers, rows: parsed, errors } = parseCSV(text)
      setParseErrors(errors)

      if (parsed.length === 0) {
        setParseErrors([...errors, 'No data rows found in file'])
        return
      }

      // Check for required headers
      const missingHeaders = templateDef.required.filter(h => !headers.includes(h))
      if (missingHeaders.length > 0) {
        setParseErrors([...errors, `Missing required columns: ${missingHeaders.join(', ')}`])
        return
      }

      const validated = validateRows(parsed)
      setRows(validated)
      setStep('preview')
    }
    reader.readAsText(file)
  }

  async function handleImport() {
    setStep('importing')
    try {
      const result = await onImport(validRows)
      setImportResult(result)
      setStep('done')
    } catch (err) {
      setImportResult({ success: false, count: 0, errors: [err.message] })
      setStep('done')
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-start justify-center p-4 pt-[8vh] overflow-y-auto" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-3xl">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-bold text-stone-900">Import {entityName}</h2>
            <p className="text-sm text-stone-500 mt-0.5">
              {step === 'upload' && 'Upload a CSV file or download the template first'}
              {step === 'preview' && `${validRows.length} valid, ${invalidRows.length} with issues`}
              {step === 'importing' && 'Importing...'}
              {step === 'done' && 'Import complete'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 text-stone-400 hover:text-stone-600">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* ── Upload Step ── */}
        {step === 'upload' && (
          <div>
            {/* Template download */}
            <div className="mb-6 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-sm font-medium text-emerald-800">Start with the template</div>
                  <div className="text-xs text-emerald-600 mt-1">
                    Download the CSV template, fill in your {entityName}, then upload it here.
                    Only <strong>name</strong> is required — all other columns are optional.
                  </div>
                </div>
                <button onClick={handleDownloadTemplate} className="shrink-0 ml-4 px-4 py-2 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
                  Download Template
                </button>
              </div>
            </div>

            {/* File upload */}
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-stone-200 rounded-2xl p-12 text-center cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors"
            >
              <svg className="mx-auto mb-3 text-stone-300" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <div className="text-sm font-medium text-stone-600">Click to upload CSV file</div>
              <div className="text-xs text-stone-400 mt-1">or drag and drop</div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>

            {/* Parse errors */}
            {parseErrors.length > 0 && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl">
                <div className="text-sm font-medium text-red-800 mb-1">Issues with file</div>
                {parseErrors.map((e, i) => <div key={i} className="text-xs text-red-600">{e}</div>)}
              </div>
            )}

            {/* Column reference */}
            <div className="mt-6">
              <div className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">Available Columns</div>
              <div className="flex flex-wrap gap-1.5">
                {templateDef.headers.map(h => (
                  <span key={h} className={`px-2 py-1 rounded-lg text-xs font-medium ${
                    templateDef.required.includes(h)
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-stone-100 text-stone-500'
                  }`}>
                    {h.replace(/_/g, ' ')}{templateDef.required.includes(h) ? ' *' : ''}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Preview Step ── */}
        {step === 'preview' && (
          <div>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-stone-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-stone-900">{rows.length}</div>
                <div className="text-xs text-stone-500">Total rows</div>
              </div>
              <div className="bg-emerald-50 rounded-xl p-3 text-center">
                <div className="text-2xl font-bold text-emerald-700">{validRows.length}</div>
                <div className="text-xs text-emerald-600">Ready to import</div>
              </div>
              <div className={`rounded-xl p-3 text-center ${invalidRows.length > 0 ? 'bg-amber-50' : 'bg-stone-50'}`}>
                <div className={`text-2xl font-bold ${invalidRows.length > 0 ? 'text-amber-600' : 'text-stone-400'}`}>{invalidRows.length}</div>
                <div className={`text-xs ${invalidRows.length > 0 ? 'text-amber-500' : 'text-stone-400'}`}>With issues</div>
              </div>
            </div>

            {/* Invalid rows */}
            {invalidRows.length > 0 && (
              <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="text-sm font-medium text-amber-800 mb-2">Rows with issues (will be skipped)</div>
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {invalidRows.map(r => (
                    <div key={r._row} className="text-xs text-amber-700">
                      Row {r._row}: {r.name || '(no name)'} — {r._issues.join(', ')}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Preview table */}
            <div className="border border-stone-200 rounded-xl overflow-hidden mb-4">
              <div className="max-h-64 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="bg-stone-50 sticky top-0">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-stone-500">Status</th>
                      <th className="px-3 py-2 text-left font-semibold text-stone-500">Name</th>
                      <th className="px-3 py-2 text-left font-semibold text-stone-500">Phone</th>
                      <th className="px-3 py-2 text-left font-semibold text-stone-500">Email</th>
                      {entityName === 'clients' && <th className="px-3 py-2 text-left font-semibold text-stone-500">Address</th>}
                      {entityName === 'workers' && <th className="px-3 py-2 text-left font-semibold text-stone-500">Role</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 50).map(r => (
                      <tr key={r._row} className={`border-t border-stone-100 ${r._valid ? '' : 'bg-amber-50/50'}`}>
                        <td className="px-3 py-2">
                          {r._valid
                            ? <span className="text-emerald-600">✓</span>
                            : <span className="text-amber-500" title={r._issues.join(', ')}>⚠</span>
                          }
                        </td>
                        <td className="px-3 py-2 text-stone-900 font-medium">{r.name || '—'}</td>
                        <td className="px-3 py-2 text-stone-600">{r.phone || '—'}</td>
                        <td className="px-3 py-2 text-stone-600">{r.email || '—'}</td>
                        {entityName === 'clients' && <td className="px-3 py-2 text-stone-600 truncate max-w-[200px]">{r.address || '—'}</td>}
                        {entityName === 'workers' && <td className="px-3 py-2 text-stone-600">{r.role || 'worker'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 50 && (
                <div className="px-3 py-2 bg-stone-50 text-xs text-stone-400 text-center border-t border-stone-100">
                  Showing first 50 of {rows.length} rows
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button onClick={() => { setStep('upload'); setRows([]); setParseErrors([]) }} className="flex-1 py-2.5 bg-stone-100 text-stone-600 text-sm font-medium rounded-xl hover:bg-stone-200 transition-colors">
                Back
              </button>
              <button
                onClick={handleImport}
                disabled={validRows.length === 0}
                className="flex-1 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 disabled:opacity-50 transition-colors"
              >
                Import {validRows.length} {entityName}
              </button>
            </div>
          </div>
        )}

        {/* ── Importing Step ── */}
        {step === 'importing' && (
          <div className="text-center py-12">
            <div className="inline-block w-8 h-8 border-3 border-emerald-200 border-t-emerald-700 rounded-full animate-spin mb-4" style={{ borderWidth: '3px' }} />
            <div className="text-sm text-stone-600">Importing {validRows.length} {entityName}...</div>
          </div>
        )}

        {/* ── Done Step ── */}
        {step === 'done' && importResult && (
          <div className="text-center py-8">
            {importResult.success ? (
              <>
                <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#059669" strokeWidth="2.5" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div className="text-lg font-bold text-stone-900 mb-1">Import Complete</div>
                <div className="text-sm text-stone-500">{importResult.count} {entityName} imported successfully</div>
                {importResult.skipped > 0 && (
                  <div className="text-xs text-amber-600 mt-1">{importResult.skipped} duplicates skipped</div>
                )}
              </>
            ) : (
              <>
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </div>
                <div className="text-lg font-bold text-stone-900 mb-1">Import Failed</div>
                {importResult.errors?.map((e, i) => <div key={i} className="text-sm text-red-600">{e}</div>)}
              </>
            )}
            <button onClick={onClose} className="mt-6 px-6 py-2.5 bg-emerald-700 text-white text-sm font-medium rounded-xl hover:bg-emerald-800 transition-colors">
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
