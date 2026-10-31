const jwt = require('jsonwebtoken');
const { readAuthCookie } = require('../utils/authCookie');

function autenticarProfissional(req, res, next) {
    const token = readAuthCookie(req, 'profissional');
    if (!token) return res.status(401).json({ erro: 'Token não fornecido' });

    try {
        const dados = jwt.verify(token, process.env.JWT_SECRET);
        if (dados.tipo !== 'profissional') {
            return res.status(401).json({ erro: 'Sessão do painel inválida. Entre novamente.' });
        }
        req.profissional = dados;
        next();
    } catch (err) {
        res.status(401).json({ erro: 'Token inválido' });
    }
}

module.exports = autenticarProfissional;
