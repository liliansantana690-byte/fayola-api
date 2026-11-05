// Criptografia dos tokens do Mercado Pago guardados no banco (AES-256-GCM).
// A chave fica só na variável CHAVE_CRIPTO do Render (32 bytes em base64).
const crypto = require('crypto');

const PREFIXO = 'enc:';

function chave() {
    const bruto = process.env.CHAVE_CRIPTO;
    if (!bruto) throw new Error('CHAVE_CRIPTO nao configurada');
    const buf = Buffer.from(bruto, 'base64');
    if (buf.length !== 32) throw new Error('CHAVE_CRIPTO precisa ter 32 bytes em base64');
    return buf;
}

function cifrar(texto) {
    if (!texto) return texto;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', chave(), iv);
    const cifrado = Buffer.concat([cipher.update(String(texto), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return PREFIXO + Buffer.concat([iv, tag, cifrado]).toString('base64');
}

function decifrar(valor) {
    if (!valor) return valor;
    if (!valor.startsWith(PREFIXO)) return valor; // valor antigo, ainda sem criptografia
    const buf = Buffer.from(valor.slice(PREFIXO.length), 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const cifrado = buf.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', chave(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString('utf8');
}

function estaCriptografado(valor) {
    return !!valor && valor.startsWith(PREFIXO);
}

module.exports = { cifrar, decifrar, estaCriptografado };