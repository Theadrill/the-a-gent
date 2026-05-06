
const { getActiveSocket } = require('./src/plugins/whatsapp/connection');

async function test() {
    const sock = getActiveSocket();
    if (sock) {
        console.log('User ID:', sock.user.id);
        console.log('User LID:', sock.user.lid);
    } else {
        console.log('Socket not active');
    }
}

test();
