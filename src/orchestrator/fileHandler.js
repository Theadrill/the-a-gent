const { downloadMediaMessage, downloadContentFromMessage } = require('baileys');
const path = require('path');
const fs = require('fs');
const config = require('../../config.json');
const DOWNLOAD_TIMEOUT_MS = 10000;

async function handleFile(sock, sender, msg, processTextMessage) {
  try {
    const msgContent = msg.message?.ephemeralMessage?.message || msg.message?.viewOnceMessage?.message || msg.message;
    const doc = msgContent?.documentMessage;
    if (!doc) return;

    const maxMb = Number(config?.seguranca?.max_file_size_mb) || 2;
    const maxBytes = maxMb * 1024 * 1024;

    let reportedSize = 0;
    try {
      if (doc.fileLength && typeof doc.fileLength.toNumber === 'function') {
        reportedSize = doc.fileLength.toNumber();
      } else {
        reportedSize = Number(doc.fileLength || doc.fileLengthLow || doc.fileSize || doc.size || 0) || 0;
      }
    } catch (e) {
      reportedSize = 0;
    }

    if (reportedSize > maxBytes) {
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: `Arquivo muito grande (${(reportedSize / 1024 / 1024).toFixed(1)}MB). Limite: ${maxMb}MB.` });
      }
      return;
    }

    const allowedExtensions = ['.js', '.ts', '.txt', '.json', '.md', '.py'];
    const ext = path.extname(doc.fileName || '').toLowerCase();
    const mime = doc.mimetype || '';

    if (!allowedExtensions.includes(ext) && !mime.startsWith('text') && mime !== 'application/json') {
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: 'Extensão ou tipo de arquivo não suportado.' });
      }
      return;
    }

    if (typeof downloadMediaMessage !== 'function' || typeof downloadContentFromMessage !== 'function') {
      throw new Error('downloadMediaMessage ou downloadContentFromMessage não disponíveis');
    }

    let buffer;

    try {
      const downloadPromise = (async () => {
        try {
          return await downloadMediaMessage(msg, 'buffer', {});
        } catch (e) {
          const stream = await downloadContentFromMessage(doc, 'document');
          const chunks = [];
          for await (const chunk of stream) chunks.push(Buffer.from(chunk));
          return Buffer.concat(chunks);
        }
      })();

      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('download timeout')), DOWNLOAD_TIMEOUT_MS)
      );

      buffer = await Promise.race([downloadPromise, timeoutPromise]);
    } catch (e) {
      console.error('[FILE_HANDLER][ERRO] download', e);
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: 'Falha ao baixar arquivo.' });
      }
      return;
    }

    if (!Buffer.isBuffer(buffer)) {
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: 'Falha ao baixar arquivo.' });
      }
      return;
    }

    const safeName = String(doc.fileName || 'unnamed').replace(/[^a-zA-Z0-9._-]/g, '_');
    const safeBase = path.basename(safeName);
    const tempDir = path.resolve(process.cwd(), 'temp_workspace');
    const tmpPath = path.join(tempDir, `.${safeBase}.${Date.now()}.tmp`);
    const finalPath = path.join(tempDir, safeBase);

    try {
      fs.mkdirSync(tempDir, { recursive: true });
    } catch (e) {
      // ignore if already exists
    }

    try {
      fs.writeFileSync(tmpPath, buffer);
      fs.renameSync(tmpPath, finalPath);
    } catch (e) {
      console.error('[FILE_HANDLER][ERRO] salvamento', e);
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: 'Falha ao salvar arquivo no servidor.' });
      }
      throw e;
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (e) { /* ignore */ }
    }

    let conteudo = '';
    try {
      conteudo = buffer.toString('utf-8');
    } catch (e) {
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: 'Erro ao ler arquivo.' });
      }
      return;
    }

    const fullText = `[ARQUIVO RECEBIDO: ${safeBase}]\n\nConteudo:\n${conteudo}`;

    if (typeof processTextMessage === 'function') {
      await processTextMessage(sock, sender, fullText, msg);
    }
  } catch (error) {
    console.error('[FILE_HANDLER][ERRO]', error);
  }
}

module.exports = { handleFile };
