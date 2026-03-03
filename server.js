import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { VertexAI } from '@google-cloud/vertexai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// --- Static files ---
app.use(express.static(path.join(__dirname, 'static')));

// --- Firebase config endpoint (avoids EJS injection in HTML) ---
app.get('/app-config.js', (req, res) => {
    const config = {
        apiKey: process.env.FB_API_KEY || '',
        authDomain: process.env.FB_AUTH_DOMAIN || '',
        projectId: process.env.FB_PROJECT_ID || '',
        storageBucket: process.env.FB_STORAGE_BUCKET || '',
        messagingSenderId: process.env.FB_MESSAGING_SENDER_ID || '',
        appId: process.env.FB_APP_ID || '',
        databaseId: process.env.FIREBASE_DATABASE_ID || 'fairy',
    };
    res.setHeader('Content-Type', 'application/javascript');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    res.send(`window.FIREBASE_CONFIG = ${JSON.stringify(config)};`);
});

// --- EJS templating ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// --- Vertex AI setup (lazy-initialized on first AI request) ---
const PROJECT_ID = process.env.GOOGLE_CLOUD_PROJECT;
const LOCATION = 'us-central1';
const MODEL_ID = 'gemini-2.5-flash';

let vertexAI = null;
let suggestModel = null;
let chatModel = null;

const CHAT_SYSTEM_INSTRUCTION = `你是 Mixbag 智能清单助手。用户可以通过自然语言让你操作他们的清单。

你必须返回一个 JSON 对象，格式如下：
{
  "reply": "你对用户说的话（简洁友好的中文）",
  "actions": [
    {"type": "action_type", ...params}
  ]
}

可用的 action types：
1. {"type": "create_list", "name": "清单名", "tags": ["标签"], "items": [{"name": "项目名", "category": "分类"}]}
2. {"type": "add_items", "list_name": "目标清单名", "items": [{"name": "项目名", "category": "分类"}]}
3. {"type": "remove_items", "list_name": "目标清单名", "item_names": ["项目名"]}
4. {"type": "update_items", "list_name": "目标清单名", "updates": [{"old_name": "旧项目名", "new_name": "新项目名(可选)", "new_category": "新分类(可选)"}]}
5. {"type": "rename_list", "old_name": "旧名", "new_name": "新名"}
6. {"type": "delete_list", "list_name": "清单名"}
7. {"type": "duplicate_list", "list_name": "源清单名", "new_name": "新清单名"}
8. {"type": "add_tags", "list_name": "清单名", "tags": ["标签"]}
9. {"type": "remove_tags", "list_name": "清单名", "tags": ["标签"]}
10. {"type": "suggest_items", "list_name": "清单名", "items": [{"name": "建议项", "category": "分类"}]}
11. {"type": "open_list", "list_name": "清单名"}

重要原则：
- 当用户要求添加项目时，请你**必须**利用常识为该项目分配一个合理的 "category"（分类），比如"太阳镜"属于"服装/配饰"，"护照"属于"证件"，绝对不要用"未分类"或者让它为空。
- **当用户要求创建一个新的清单（如“去盐湖城滑雪”、“露营装备”等）时，请在创建清单的同时，主动根据常识为该清单建议 5-10 个最核心的项目。**
- 如果用户要求修改已有项目的名称或移到新分类，请使用 update_items。
- 如果用户的请求不涉及操作，actions 可以为空数组。
- 处理完成后，用 friendly、自然的话语回复。
请始终用中文回复。只返回 JSON，不要包含 markdown 代码块标记。`;

function getModels() {
    if (!vertexAI) {
        vertexAI = new VertexAI({ project: PROJECT_ID, location: LOCATION });
        suggestModel = vertexAI.getGenerativeModel({ model: MODEL_ID });
        chatModel = vertexAI.getGenerativeModel({
            model: MODEL_ID,
            systemInstruction: { parts: [{ text: CHAT_SYSTEM_INSTRUCTION }] },
        });
    }
    return { suggestModel, chatModel };
}

// --- Routes ---

// Home page
app.get('/', (req, res) => res.render('index'));

// AI suggest endpoint
app.post('/api/ai/suggest', async (req, res) => {
    const { title = '', items = [] } = req.body;
    const prompt = `Suggest 5 additional items for a checklist titled '${title}'. Current items: ${items.join(', ')}. Return only the items as a comma-separated list.`;

    try {
        const { suggestModel } = getModels();
        const result = await suggestModel.generateContent(prompt);
        const text = result.response.candidates[0].content.parts[0].text;
        const suggestions = text.split(',').map(s => s.trim()).filter(Boolean);
        res.json({ suggestions });
    } catch (err) {
        console.error('AI Suggest Error:', err);
        const suggestions = [
            `Essential ${title} item 1`,
            `Safety ${title} item 2`,
            'Backup batteries',
            'Map/GPS',
            'Emergency whistle',
        ];
        res.json({ suggestions });
    }
});

// AI chat endpoint
app.post('/api/ai/chat', async (req, res) => {
    const { message = '', context = {}, history = [] } = req.body;
    const bagsInfo = context.bags || [];
    const currentBag = context.currentBag || null;

    let contextStr = '用户的清单列表：\n';
    for (const b of bagsInfo) {
        const tags = (b.tags || []).join(', ');
        const itemsCount = (b.items || []).length;
        contextStr += `- ${b.name}（${itemsCount}个项目，标签：${tags}）\n`;
        if (currentBag && b.name === currentBag) {
            for (const item of b.items || []) {
                if (typeof item === 'object' && item !== null) {
                    contextStr += `    · ${item.name || '?'} [${item.category || '未分类'}]\n`;
                } else {
                    contextStr += `    · ${item}\n`;
                }
            }
        }
    }

    if (currentBag) {
        contextStr += `\n用户当前打开的清单：${currentBag}\n`;
    }

    // Prepend context to the latest message to ensure the model has up-to-date info
    const fullPrompt = `${contextStr}\n用户消息：${message}`;

    try {
        const { chatModel } = getModels();

        // Convert incoming history to the format expected by startChat
        const formattedHistory = history.map(h => ({
            role: h.role,
            parts: [{ text: h.text }]
        }));

        const chatSession = chatModel.startChat({ history: formattedHistory });
        const result = await chatSession.sendMessage(fullPrompt);
        let text = result.response.candidates[0].content.parts[0].text.trim();

        // Strip markdown code blocks if present
        if (text.startsWith('```')) {
            text = text.includes('\n') ? text.split('\n').slice(1).join('\n') : text.slice(3);
            if (text.endsWith('```')) {
                text = text.slice(0, -3);
            }
            text = text.trim();
        }

        const parsed = JSON.parse(text);
        res.json(parsed);
    } catch (err) {
        if (err instanceof SyntaxError) {
            console.error('JSON parse error:', err.message);
            res.json({ reply: '抱歉，我没理解您的意思。', actions: [] });
        } else {
            console.error('AI Chat Error:', err);
            res.json({ reply: `抱歉，出了点问题：${err.message}`, actions: [] });
        }
    }
});

// --- Start server ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Mixbag server listening on port ${PORT}`);
});
