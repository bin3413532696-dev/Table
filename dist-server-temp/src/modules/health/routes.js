"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthRoutes = healthRoutes;
async function healthRoutes(app) {
    app.get('/', async () => {
        return {
            ok: true,
            service: 'table-api',
            timestamp: new Date().toISOString(),
        };
    });
}
