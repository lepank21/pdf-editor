import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execAsync = promisify(exec);
const app = express();
const PORT = 3001;

// Serve the Vite dev output (for production use)
app.use(express.json());

/**
 * POST /api/convert-docx
 * Body: multipart form with file field "docx"
 * Returns: PDF binary with Content-Type application/pdf
 */
app.post('/api/convert-docx', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-conv-'));
  const inputPath = path.join(tmpDir, 'input.docx');
  const outputPath = path.join(tmpDir, 'input.pdf');

  try {
    // Write uploaded bytes to temp file
    fs.writeFileSync(inputPath, req.body as Buffer);

    // PowerShell script using Microsoft Word COM automation
    const psScript = `
$word = $null
try {
  $word = New-Object -ComObject Word.Application
  $word.Visible = $false
  $word.DisplayAlerts = 0
  $doc = $word.Documents.Open("${inputPath.replace(/\\/g, '\\\\')}")
  $doc.Saved = $true
  $wdExportFormatPDF = 17
  $doc.ExportAsFixedFormat("${outputPath.replace(/\\/g, '\\\\')}", $wdExportFormatPDF)
  $doc.Close($false)
  Write-Output "SUCCESS"
} catch {
  Write-Error $_.Exception.Message
  exit 1
} finally {
  if ($word -ne $null) {
    try { $word.Quit() } catch {}
    try { [System.Runtime.Interopservices.Marshal]::ReleaseComObject($word) | Out-Null } catch {}
  }
  [System.GC]::Collect()
  [System.GC]::WaitForPendingFinalizers()
}
`.trim();

    const psFile = path.join(tmpDir, 'convert.ps1');
    fs.writeFileSync(psFile, psScript, 'utf-8');

    await execAsync(
      `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${psFile}"`,
      { timeout: 60000 }
    );

    if (!fs.existsSync(outputPath)) {
      throw new Error('File PDF tidak dihasilkan oleh Word.');
    }

    const pdfBytes = fs.readFileSync(outputPath);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="output.pdf"');
    res.send(pdfBytes);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[convert-docx] Error:', msg);
    res.status(500).json({ error: msg });
  } finally {
    // Cleanup temp files
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, wordPath: 'C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE' });
});

app.listen(PORT, () => {
  console.log(`[PDF Server] Berjalan di http://localhost:${PORT}`);
  console.log(`[PDF Server] Endpoint: POST http://localhost:${PORT}/api/convert-docx`);
});
