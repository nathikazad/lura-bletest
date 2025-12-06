const express = require('express');
const app = express();
const PORT = 3000;

// Middleware to parse JSON bodies
app.use(express.json());

// POST endpoint to receive a number
app.post('/number', (req, res) => {
  const { number } = req.body;
  
  if (number === undefined) {
    return res.status(400).json({ error: 'Number is required' });
  }
  
  const num = Number(number);
  
  if (isNaN(num)) {
    return res.status(400).json({ error: 'Invalid number' });
  }
  
  // Print the number with timestamp
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Received number: ${num}`);
  
  // Send success response
  res.json({ 
    success: true, 
    received: num,
    timestamp 
  });
});

// GET endpoint for health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`POST numbers to: http://localhost:${PORT}/number`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

