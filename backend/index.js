require('dotenv').config();
const express = require('express');
const cors = require('cors');

const projectsRouter = require('./routes/projects');
const airdropsRouter = require('./routes/airdrops');
const webhooksRouter = require('./routes/webhooks');
const subscriptionsRouter = require('./routes/subscriptions');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Routes
app.use('/api/projects', projectsRouter);
app.use('/api/airdrops', airdropsRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/webhooks', webhooksRouter);

app.listen(PORT, () => {
  console.log(`Token OS backend running on port ${PORT}`);
});
