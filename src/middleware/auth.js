const jwt = require('jsonwebtoken');

function autenticar(req, res, next) {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ erro: 'Token não fornecido' });

    try {
        const dados = jwt.verify(token, process.env.JWT_SECRET);
        if (dados.tipo !== 'estabelecimento') {
            return res.status(403).json({ erro: 'Acesso negado' });
        }
        req.estabelecimento = dados;
        next();
    } catch (err) {
        res.status(401).json({ erro: 'Token inválido' });
    }
}

module.exports = autenticar;