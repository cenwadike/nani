// scripts/generate-swagger.ts
import swaggerJsdoc from 'swagger-jsdoc';
import fs from 'fs';
import YAML from 'yamljs';

const options = {
  definition: {
    openapi: '3.0.3',
    info: {
      title: 'Nani API',
      version: '1.0.0',
      description: 'Real-Time Polkadot Event Notifications API',
    },
    servers: [
      { url: 'http://localhost:3000', description: 'Local' },
      { url: 'https://nani-production-c105.up.railway.app', description: 'Production' }
    ]
  },
  apis: [
    './src/routes/*.ts',
    './src/docs/openapi-components.ts',
  ],
};

const swaggerSpec = swaggerJsdoc(options);
fs.writeFileSync('./swagger.yaml', YAML.stringify(swaggerSpec, 10));
console.log('✅ swagger.yaml generated');