"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.knowledgeRoutes = knowledgeRoutes;
const http_1 = require("../../shared/http");
const schema_1 = require("./schema");
const service_1 = require("./service");
const SOURCE = 'postgres';
function listResponse(items, total) {
    return { items, total: total ?? items.length, source: SOURCE };
}
function dataResponse(data) {
    return { data, source: SOURCE };
}
async function knowledgeRoutes(app) {
    // 笔记列表
    app.get('/knowledge/notes', async (_request, reply) => {
        try {
            const items = await (0, service_1.getNoteList)();
            return listResponse(items);
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    // 创建笔记
    app.post('/knowledge/notes', async (request, reply) => {
        try {
            const payload = schema_1.createNoteSchema.parse(request.body);
            const note = await (0, service_1.createNoteRecord)(payload);
            return reply.code(201).send(dataResponse(note));
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    // 获取单个笔记
    app.get('/knowledge/notes/:id', async (request, reply) => {
        try {
            const { id } = schema_1.noteIdParamSchema.parse(request.params);
            const note = await (0, service_1.getNoteDetail)(id);
            if (!note) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Note not found' });
            }
            return dataResponse(note);
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    // 更新笔记
    app.patch('/knowledge/notes/:id', async (request, reply) => {
        try {
            const { id } = schema_1.noteIdParamSchema.parse(request.params);
            const payload = schema_1.updateNoteSchema.parse(request.body);
            const note = await (0, service_1.updateNoteRecord)(id, payload);
            if (!note) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Note not found' });
            }
            return dataResponse(note);
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    // 删除笔记
    app.delete('/knowledge/notes/:id', async (request, reply) => {
        try {
            const { id } = schema_1.noteIdParamSchema.parse(request.params);
            const deleted = await (0, service_1.deleteNoteRecord)(id);
            if (!deleted) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Note not found' });
            }
            return reply.code(204).send();
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    // 搜索笔记
    app.get('/knowledge/search', async (request, reply) => {
        try {
            const query = schema_1.noteSearchQuerySchema.parse(request.query);
            const items = await (0, service_1.searchNoteRecords)(query);
            return listResponse(items);
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    // 获取所有使用过的标签
    app.get('/knowledge/tags', async (_request, reply) => {
        try {
            const tags = await (0, service_1.getAllTags)();
            return listResponse(tags);
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    // 获取预设标签列表
    app.get('/knowledge/tags/preset', async (_request, reply) => {
        try {
            const items = await (0, service_1.getPresetTagList)();
            return listResponse(items);
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    // 创建预设标签
    app.post('/knowledge/tags/preset', async (request, reply) => {
        try {
            const payload = schema_1.createPresetTagSchema.parse(request.body);
            const tag = await (0, service_1.createPresetTagRecord)(payload);
            return reply.code(201).send(dataResponse(tag));
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    // 获取单个预设标签
    app.get('/knowledge/tags/preset/:id', async (request, reply) => {
        try {
            const { id } = schema_1.presetTagIdParamSchema.parse(request.params);
            const tag = await (0, service_1.getPresetTagDetail)(id);
            if (!tag) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Preset tag not found' });
            }
            return dataResponse(tag);
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    // 更新预设标签
    app.patch('/knowledge/tags/preset/:id', async (request, reply) => {
        try {
            const { id } = schema_1.presetTagIdParamSchema.parse(request.params);
            const payload = schema_1.updatePresetTagSchema.parse(request.body);
            const tag = await (0, service_1.updatePresetTagRecord)(id, payload);
            if (!tag) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Preset tag not found' });
            }
            return dataResponse(tag);
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    // 删除预设标签
    app.delete('/knowledge/tags/preset/:id', async (request, reply) => {
        try {
            const { id } = schema_1.presetTagIdParamSchema.parse(request.params);
            const deleted = await (0, service_1.deletePresetTagRecord)(id);
            if (!deleted) {
                return reply.code(404).send({ error: 'NOT_FOUND', message: 'Preset tag not found' });
            }
            return reply.code(204).send();
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
    // 获取知识库概览
    app.get('/knowledge/metadata', async (_request, reply) => {
        try {
            const data = await (0, service_1.getKnowledgeOverview)();
            return dataResponse(data);
        }
        catch (error) {
            return (0, http_1.sendInfrastructureError)(reply, error);
        }
    });
}
