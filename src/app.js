const express = require('express');
const cors = require('cors');
const app = express();

app.use(cors());
app.use(express.json());

const authRoutes = require('./routes/auth');
const agendamentosRoutes = require('./routes/agendamentos');
const servicosRoutes = require('./routes/servicos');
const profissionaisRoutes = require('./routes/profissionais');
const pagamentosRoutes = require('./routes/pagamentos');

app.use('/api/auth', authRoutes);
app.use('/api/agendamentos', agendamentosRoutes);
app.use('/api/servicos', servicosRoutes);
app.use('/api/profissionais', profissionaisRoutes);
app.use('/api/pagamentos', pagamentosRoutes);

module.exports = app;