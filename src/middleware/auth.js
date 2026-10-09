const jwt = require('jsonwebtoken');
const { lerCookie, origemValida } = require('../utils/sessao');

const NOME_COOKIE = 'fayola_dono';

function autenticar(req, res, next) {
    if (!origemValida(req)) {
        return res.status(403).json({ erro: 'Origem não permitida' });
    }

    const token = lerCookie(req, NOME_COOKIE);
    if (!token) {
        return res.status(401).json({ erro: 'Não autenticado' });
    }

    try {
        const dados = jwt.verify(token, process.env.JWT_SECRET);
        if (dados.tipo !== 'estabelecimento') {
            return res.status(403).json({ erro: 'Acesso negado' });
        }
        req.estabelecimento = dados;
        next();
    } catch (err) {
        res.status(401).json({ erro: 'Sessão inválida ou expirada' });
    }
}

module.exports = autenticar;