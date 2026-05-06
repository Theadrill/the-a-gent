const { handleFile } = require('./fileHandler');

async function routeMedia(sock, sender, msgContent, msg, processTextMessage) {
  try {
    if (!msgContent || typeof msgContent !== 'object') {
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: 'Recebi conteúdo inválido.' });
      }
      return;
    }

    if (msgContent.imageMessage) {
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: '🖼️ Recebi uma mídia visual. O suporte a imagens estará disponível em breve!' });
      }
    } else if (msgContent.audioMessage) {
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: '🎙️ Recebi um áudio. O suporte a transcrição estará disponível em breve!' });
      }
    } else if (msgContent.documentMessage) {
      await handleFile(sock, sender, msg, processTextMessage);
    } else if (msgContent.videoMessage) {
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: '🖼️ Recebi uma mídia visual. O suporte a imagens estará disponível em breve!' });
      }
    } else if (msgContent.stickerMessage) {
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: '🖼️ Recebi uma mídia visual. O suporte a imagens estará disponível em breve!' });
      }
    } else {
      if (sock && typeof sock.sendMessage === 'function') {
        await sock.sendMessage(sender, { text: 'Recebi um tipo de mídia não reconhecido.' });
      }
    }
  } catch (error) {
    console.error('[MEDIA_ROUTER][ERRO]', error);
  }
}

module.exports = { routeMedia };
