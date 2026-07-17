# 💈 Fayola — API

Backend do sistema de agendamento online para salões, barbearias e estéticas.

## 🔗 Links

- **API em produção:** https://fayola-api-production.up.railway.app
- **Frontend:** https://github.com/liliansantana690-byte/fayola-frontend
- **Landing Page:** https://fayola-frontend-hlfj.vercel.app

## 🚀 Funcionalidades

- Cadastro e login de estabelecimentos com JWT
- Cadastro, listagem e exclusão de serviços
- Cadastro, listagem e exclusão de profissionais
- Agendamento online pelo cliente (sem login)
- Notificação automática via WhatsApp na confirmação
- Lembrete automático 24h antes do agendamento
- Agenda do dia com receita
- Cancelamento de agendamentos
- Dados públicos do estabelecimento para página de agendamento

## 🛠️ Tecnologias

- Node.js + Express
- PostgreSQL (Neon)
- JWT (autenticação)
- Bcrypt (criptografia de senha)
- Twilio (WhatsApp)
- node-cron

## ⚙️ Como rodar localmente

1. Clone o repositório
2. Instale as dependências:
```bash
   npm install
```
3. Crie o arquivo `.env` baseado no `.env.example`
4. Crie o banco de dados PostgreSQL e execute o schema
5. Rode o servidor:
```bash
   node index.js
```

## 📱 Endpoints principais

- `POST /api/auth/cadastro` — cadastro do estabelecimento
- `POST /api/auth/login` — login
- `GET /api/auth/estabelecimento/:id` — dados públicos
- `POST /api/servicos` — criar serviço (autenticado)
- `DELETE /api/servicos/:id` — excluir serviço (autenticado)
- `POST /api/profissionais` — criar profissional (autenticado)
- `DELETE /api/profissionais/:id` — excluir profissional (autenticado)
- `POST /api/agendamentos` — criar agendamento (público)
- `GET /api/agendamentos/hoje` — agendamentos do dia (autenticado)
- `PATCH /api/agendamentos/:id/cancelar` — cancelar agendamento

## 👩‍💻 Autora

Lilian Santana — Estudante de Engenharia de Software
GitHub: github.com/liliansantana690-byte