import os
from flask import Flask, render_template, request, jsonify
from firebase_config import db, auth_client
import vertexai
from vertexai.generative_models import GenerativeModel
import json
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-key-for-mixbag")

# Initialize Vertex AI
PROJECT_ID = os.environ.get("GOOGLE_CLOUD_PROJECT")
vertexai.init(project=PROJECT_ID, location="us-central1")
suggest_model = GenerativeModel("gemini-2.5-flash")
chat_model = GenerativeModel(
    "gemini-2.5-flash",
    system_instruction="""你是 Mixbag 智能清单助手。用户可以通过自然语言让你操作他们的清单。

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
- 当用户要求添加项目时，请你**必须**利用常识为该项目分配一个合理的 "category"（分类），比如“太阳镜”属于“服装/配饰”，“护照”属于“证件”，绝对不要用“未分类”或者让它为空。
- 如果用户要求修改已有项目的名称或移到新分类，请使用 update_items。
- 如果用户的请求不涉及操作，actions 可以为空数组。
- 处理完成后，用 friendly、自然的话语回复。
请始终用中文回复。只返回 JSON，不要包含 markdown 代码块标记。"""
)

@app.route('/')
def index():
    fb_config = {
        "apiKey": os.environ.get("FB_API_KEY", ""),
        "authDomain": os.environ.get("FB_AUTH_DOMAIN", ""),
        "projectId": os.environ.get("FB_PROJECT_ID", ""),
        "storageBucket": os.environ.get("FB_STORAGE_BUCKET", ""),
        "messagingSenderId": os.environ.get("FB_MESSAGING_SENDER_ID", ""),
        "appId": os.environ.get("FB_APP_ID", ""),
        "databaseId": os.environ.get("FIREBASE_DATABASE_ID", "fairy")
    }
    return render_template('index.html', firebase_config=fb_config)

@app.route('/api/checklists', methods=['GET'])
def get_checklists():
    return jsonify({"checklists": []})

@app.route('/api/ai/suggest', methods=['POST'])
def ai_suggest():
    data = request.json
    title = data.get('title', '')
    items = data.get('items', [])
    prompt = f"Suggest 5 additional items for a checklist titled '{title}'. Current items: {', '.join(items)}. Return only the items as a comma-separated list."
    try:
        response = suggest_model.generate_content(prompt)
        suggestions = [item.strip() for item in response.text.split(',')]
    except Exception as e:
        print(f"AI Error: {e}")
        suggestions = [f"Essential {title} item 1", f"Safety {title} item 2", "Backup batteries", "Map/GPS", "Emergency whistle"]
    return jsonify({"suggestions": suggestions})

@app.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    data = request.json
    message = data.get('message', '')
    context = data.get('context', {})

    # Build context string
    bags_info = context.get('bags', [])
    current_bag = context.get('currentBag', None)

    context_str = f"用户的清单列表：\n"
    for b in bags_info:
        tags = ', '.join(b.get('tags', []))
        items_count = len(b.get('items', []))
        context_str += f"- {b['name']}（{items_count}个项目，标签：{tags}）\n"
        # Include items for current bag
        if current_bag and b.get('name') == current_bag:
            for item in b.get('items', []):
                if isinstance(item, dict):
                    context_str += f"    · {item.get('name','?')} [{item.get('category','未分类')}]\n"
                else:
                    context_str += f"    · {item}\n"

    if current_bag:
        context_str += f"\n用户当前打开的清单：{current_bag}\n"

    prompt = f"{context_str}\n用户消息：{message}"

    try:
        response = chat_model.generate_content(prompt)
        text = response.text.strip()
        # Strip markdown code blocks if present
        if text.startswith('```'):
            text = text.split('\n', 1)[1] if '\n' in text else text[3:]
            if text.endswith('```'):
                text = text[:-3]
            text = text.strip()
        result = json.loads(text)
        return jsonify(result)
    except json.JSONDecodeError as e:
        print(f"JSON parse error: {e}, raw: {response.text if 'response' in dir() else 'no response'}")
        return jsonify({"reply": response.text if 'response' in dir() else "抱歉，我没理解您的意思。", "actions": []})
    except Exception as e:
        print(f"AI Chat Error: {e}")
        return jsonify({"reply": f"抱歉，出了点问题：{str(e)}", "actions": []})

if __name__ == '__main__':
    app.run(debug=True, port=5000)
