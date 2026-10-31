const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { readAuthCookie } = require('../utils/authCookie');

async function autenticarProfissional(req, res, next) {
    const token = readAuthCookie(req, 'profissional');
    if (!token) return res.status(401).json({ erro: 'Token não fornecido' });
    let dados;
    try {
        dados = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ erro: 'Token inválido' });
    }
    if (dados.tipo !== 'profissional') return res.status(401).json({ erro: 'Sessão do painel inválida. Entre novamente.' });
    try {
        const result = await pool.query('SELECT ativo FROM profissionais WHERE id = $1 AND estabelecimento_id = $2', [dados.id, dados.estabelecimento_id]);
        if (!result.rows.length || !result.rows[0].ativo) return res.status(401).json({ erro: 'Esta conta profissional foi desativada.' });
        req.profissional = dados;
        return next();
    } catch (err) {
        console.error('ERRO AO VALIDAR CONTA PROFISSIONAL:', err.message);
        return res.status(500).json({ erro: 'Não foi possível validar a sessão profissional.' });
    }
}
module.exports = autenticarProfissional;
