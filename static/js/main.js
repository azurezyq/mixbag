import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, collection, getDocs, getDoc, addDoc, serverTimestamp, query, where, onSnapshot, updateDoc, doc, deleteDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = window.FIREBASE_CONFIG || {};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, firebaseConfig.databaseId || "fairy");
const provider = new GoogleAuthProvider();

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    const $ = id => document.getElementById(id);
    const loginBtn = $('login-btn'), logoutBtn = $('logout-btn'), userProfile = $('user-profile'),
        userName = $('user-name'), userPhoto = $('user-photo'), checklistList = $('checklist-list'),
        contentView = $('content'), rightPanel = $('right-panel'),
        tagBar = $('tag-bar'), listSearch = $('list-search'), filterStarredBtn = $('filter-starred'),
        settingsBtn = $('settings-btn'), createListBtn = $('create-list-btn'),
        categoryModal = $('category-modal'), categoryOptions = $('category-options'),
        createModal = $('create-modal');

    // Service Worker Registration for PWA Installability
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js').then(reg => {
            console.log('ServiceWorker registered with scope:', reg.scope);
        }).catch(err => {
            console.error('ServiceWorker registration failed:', err);
        });
    }

    let currentUser = null, userBags = [], selectedBags = new Set(),
        showOnlyStarred = false, selectedTag = null, searchQuery = '';
    let isEditMode = true;
    let movingBag = null, movingItem = null, movingCallback = null;
    let currentOpenBagName = null;
    let chatHistory = []; // { role: 'user'|'model', text: '...' }

    // Settings (stored in localStorage)
    let settings = JSON.parse(localStorage.getItem('mixbag_settings') || '{}');

    const isMobile = () => window.innerWidth < 768;

    // On mobile: show/hide the right panel overlay
    // On desktop: the panel is always visible, so we swap content inside it
    function showRightPanel() { if (isMobile()) rightPanel.classList.add('active'); }
    function goBack() {
        currentOpenBagName = null;
        if (isMobile()) rightPanel.classList.remove('active');
        else resetView();  // <-- this is the fix: on desktop, just reset content
    }

    // ===== AUTH =====
    loginBtn.onclick = () => {
        if (isMobile()) {
            signInWithRedirect(auth, provider);
        } else {
            signInWithPopup(auth, provider);
        }
    };
    logoutBtn.onclick = () => signOut(auth);

    // Handle redirect result on page load (for mobile Google Sign-In flow)
    getRedirectResult(auth).catch(err => console.warn('Redirect result error:', err));

    filterStarredBtn.onclick = () => { showOnlyStarred = !showOnlyStarred; filterStarredBtn.classList.toggle('active', showOnlyStarred); renderBags(); };
    listSearch.oninput = e => { searchQuery = e.target.value.toLowerCase(); renderBags(); };

    onAuthStateChanged(auth, async user => {
        if (user) {
            currentUser = user;
            userProfile.classList.remove('hidden');
            loginBtn.classList.add('hidden');
            userName.textContent = user.displayName;
            userPhoto.src = user.photoURL;
            await loadUserBags();
            loadChatHistory();
            // Onboarding check
            setTimeout(async () => {
                if (userBags.length === 0 && !localStorage.getItem(`onboarded_${user.uid}`)) {
                    console.log("New user onboarding...");
                    try {
                        const s = await getDocs(collection(db, 'checklists'));
                        const templates = s.docs.map(d => d.data());
                        for (const tpl of templates) {
                            await addDoc(collection(db, 'user_checklists'), {
                                userId: user.uid,
                                name: tpl.name,
                                items: tpl.items || [],
                                checkedItems: [],
                                isStarred: false,
                                tags: tpl.tags || [],
                                createdAt: serverTimestamp()
                            });
                        }
                        localStorage.setItem(`onboarded_${user.uid}`, 'true');
                    } catch (e) { console.error("Onboarding failed", e); }
                }
            }, 1000); // Give a moment for snapshot to fire
        }
        else { currentUser = null; userProfile.classList.add('hidden'); loginBtn.classList.remove('hidden'); userBags = []; renderBags(); }
    });

    // ===== SETTINGS (rendered inside content) =====
    settingsBtn.onclick = () => {
        showRightPanel();
        contentView.innerHTML = `
            <div class="view-header">
                <button class="icon-btn" id="back-btn"><i data-lucide="arrow-left"></i></button>
                <h2>设置</h2><div></div>
            </div>
            <div class="settings-body">
                <div class="setting-group"><h3>关于</h3>
                    <div class="setting-row"><span>版本</span><span class="dim">1.8.0</span></div>
                </div>
            </div>`;
        lucide.createIcons();
        $('back-btn').onclick = goBack;
    };

    // ===== CREATE NEW LIST =====
    createListBtn.onclick = () => {
        if (!currentUser) { alert('请先登录'); return; }
        createModal.classList.remove('hidden');
        $('create-name-input').value = '';
        $('create-tags-input').value = '';
        $('create-name-input').focus();
    };
    $('create-cancel').onclick = () => createModal.classList.add('hidden');
    $('create-confirm').onclick = async () => {
        const name = $('create-name-input').value.trim();
        if (!name) return;
        const tags = $('create-tags-input').value.split(/[,，]/).map(s => s.trim()).filter(Boolean);
        try {
            await addDoc(collection(db, 'user_checklists'), {
                userId: currentUser.uid, name, items: [], checkedItems: [],
                isStarred: false, tags, createdAt: serverTimestamp()
            });
            createModal.classList.add('hidden');
        } catch (e) { console.error(e); alert('创建失败'); }
    };
    $('create-name-input').onkeypress = e => { if (e.key === 'Enter') $('create-confirm').click(); };

    // ===== TAG BAR =====
    function renderTagBar() {
        tagBar.innerHTML = '';
        const allTags = new Set();
        userBags.forEach(b => (b.tags || []).forEach(t => allTags.add(t)));
        [['全部', null], ...Array.from(allTags).map(t => [t, t])].forEach(([label, tag]) => {
            const el = document.createElement('div');
            el.className = `tag-pill ${selectedTag === tag ? 'active' : ''}`;
            el.textContent = label;
            el.onclick = () => { selectedTag = tag; renderTagBar(); renderBags(); };
            tagBar.appendChild(el);
        });
    }

    // ===== BAG LIST =====
    function renderBags() {
        checklistList.innerHTML = '';
        let allBags = [...userBags];
        if (showOnlyStarred) allBags = allBags.filter(b => b.isStarred);
        if (selectedTag) allBags = allBags.filter(b => (b.tags || []).includes(selectedTag));
        if (searchQuery) allBags = allBags.filter(b => b.name.toLowerCase().includes(searchQuery) || (b.tags || []).some(t => t.toLowerCase().includes(searchQuery)));

        if (!allBags.length) { checklistList.innerHTML = `<p class="empty-msg">${showOnlyStarred ? '没有星标清单' : '没有发现清单'}</p>`; return; }

        allBags.forEach(bag => {
            const el = document.createElement('div');
            el.className = `bag-item ${selectedBags.has(bag.id) ? 'selected' : ''}`;
            el.innerHTML = `
                <div class="bag-info">
                    <i data-lucide="package"></i>
                    <div class="bag-text">
                        <span>${bag.name}</span>
                        <div class="bag-tags">
                            ${(bag.tags || []).map(t => `<span class="badge ${selectedTag === t ? 'highlight' : ''}">${t}</span>`).join('')}
                        </div>
                    </div>
                </div>
                <div class="bag-controls">
                    <button class="priority-btn" title="置顶">置顶</button>
                    <button class="icon-btn dup-btn" title="复制"><i data-lucide="copy"></i></button>
                    <button class="icon-btn star-btn ${bag.isStarred ? 'starred' : ''}" title="收藏"><i data-lucide="star"></i></button>
                    <button class="icon-btn delete-bag-btn" title="删除"><i data-lucide="trash-2"></i></button>
                    <input type="checkbox" ${selectedBags.has(bag.id) ? 'checked' : ''}>
                </div>`;
            el.onclick = async e => {
                if (e.target.closest('.priority-btn')) { e.stopPropagation(); prioritizeBag(bag); }
                else if (e.target.closest('.dup-btn')) { e.stopPropagation(); duplicateBag(bag); }
                else if (e.target.closest('.star-btn')) { e.stopPropagation(); toggleStar(bag); }
                else if (e.target.closest('.delete-bag-btn')) { e.stopPropagation(); if (confirm(`删除 "${bag.name}"？`)) await deleteBag(bag.id); }
                else if (e.target.tagName === 'INPUT') { e.stopPropagation(); toggleSelection(bag.id); }
                else openChecklist(bag);
            };
            checklistList.appendChild(el);
        });
        lucide.createIcons();
    }

    // ===== DUPLICATE =====
    async function duplicateBag(bag) {
        if (!currentUser) { alert('请先登录'); return; }
        const items = (bag.items || []).map(i => typeof i === 'string' ? { name: i, category: '未分类' } : { ...i });
        try {
            await addDoc(collection(db, 'user_checklists'), {
                userId: currentUser.uid,
                name: bag.name + ' (副本)',
                items, checkedItems: [], isStarred: false,
                tags: [...(bag.tags || [])],
                createdAt: serverTimestamp()
            });
        } catch (e) { console.error(e); alert('复制失败'); }
    }

    // ===== KTV PRIORITY =====
    function prioritizeBag(bag) {
        const idx = userBags.findIndex(b => b.id === bag.id);
        if (idx > 0) { userBags.splice(idx, 1); userBags.unshift(bag); renderBags(); }
    }

    async function toggleStar(bag) {
        bag.isStarred = !bag.isStarred; renderBags();
        if (currentUser && userBags.some(b => b.id === bag.id)) {
            try { await updateDoc(doc(db, "user_checklists", bag.id), { isStarred: bag.isStarred }); }
            catch (e) { bag.isStarred = !bag.isStarred; renderBags(); }
        }
    }

    async function deleteBag(id) {
        try { await deleteDoc(doc(db, "user_checklists", id)); userBags = userBags.filter(b => b.id !== id); renderBags(); renderTagBar(); goBack(); }
        catch (e) { console.error(e); alert("删除失败"); }
    }

    function toggleSelection(id) { if (selectedBags.has(id)) selectedBags.delete(id); else selectedBags.add(id); renderBags(); updateActionCenter(); }

    function updateActionCenter() {
        let ac = $('action-center');
        if (selectedBags.size > 0) {
            if (!ac) { ac = document.createElement('div'); ac.id = 'action-center'; document.body.appendChild(ac); }
            ac.innerHTML = `<div class="action-info"><i data-lucide="layers"></i><span>已选 ${selectedBags.size}</span></div><button id="mix-btn">混合</button>`;
            lucide.createIcons(); $('mix-btn').onclick = startMixing;
        } else if (ac) ac.remove();
    }

    function groupItems(items) {
        const g = {};
        items.forEach(it => { const c = (typeof it === 'string' ? '未分类' : it.category) || '未分类'; if (!g[c]) g[c] = []; g[c].push(typeof it === 'string' ? { name: it, category: c } : it); });
        return g;
    }

    // ===== LONG PRESS =====
    function setupLongPress(el, bag, itemName, cb) {
        let timer;
        const start = () => { el.classList.add('long-pressing'); timer = setTimeout(() => { el.classList.remove('long-pressing'); openCategoryModal(bag, itemName, cb); }, 600); };
        const cancel = () => { el.classList.remove('long-pressing'); clearTimeout(timer); };
        el.addEventListener('touchstart', start, { passive: true });
        el.addEventListener('touchend', cancel); el.addEventListener('touchmove', cancel);
        el.addEventListener('mousedown', start); el.addEventListener('mouseup', cancel); el.addEventListener('mouseleave', cancel);
    }

    function openCategoryModal(bag, name, cb) {
        movingBag = bag; movingItem = name; movingCallback = cb;
        const cats = [...new Set(bag.items.map(i => (typeof i === 'string' ? '未分类' : i.category) || '未分类'))];
        categoryOptions.innerHTML = cats.map(c => `<div class="cat-option" data-cat="${c}">${c}</div>`).join('');
        categoryModal.classList.remove('hidden');
        categoryOptions.querySelectorAll('.cat-option').forEach(o => { o.onclick = () => moveItemToCategory(o.dataset.cat); });
        $('new-category-input').value = '';
        $('new-category-confirm').onclick = () => { const v = $('new-category-input').value.trim(); if (v) moveItemToCategory(v); };
        $('category-modal-cancel').onclick = () => categoryModal.classList.add('hidden');
    }

    async function moveItemToCategory(cat) {
        const it = movingBag.items.find(i => (typeof i === 'string' ? i : i.name) === movingItem);
        if (it) { if (typeof it === 'string') { const idx = movingBag.items.indexOf(it); movingBag.items[idx] = { name: it, category: cat }; } else it.category = cat; }
        categoryModal.classList.add('hidden');
        if (movingCallback) movingCallback();
        if (currentUser && userBags.some(b => b.id === movingBag.id)) await updateDoc(doc(db, "user_checklists", movingBag.id), { items: movingBag.items });
    }

    // ===== MIXER =====
    function startMixing() {
        const sel = userBags.filter(b => selectedBags.has(b.id));
        const map = new Map();
        sel.flatMap(b => b.items).forEach(it => { const n = typeof it === 'string' ? it : it.name; const c = typeof it === 'string' ? '未分类' : it.category; if (!map.has(n)) map.set(n, c); });
        const items = Array.from(map.entries()).map(([n, c]) => ({ name: n, category: c }));
        hideActionCenter(); showRightPanel();

        const render = () => {
            const g = groupItems(items);
            contentView.innerHTML = `
                <div class="view-header">
                    <button class="icon-btn" id="back-btn"><i data-lucide="arrow-left"></i></button>
                    <input type="text" id="new-bag-name" value="我的混合清单" class="glass-input">
                    <button id="ai-btn" class="glow-btn"><i data-lucide="sparkles"></i></button>
                </div>
                <div class="add-item-bar">
                    <input type="text" id="add-mix-in" placeholder="添加 (名称/分类)…">
                    <button class="icon-btn" id="add-mix-btn"><i data-lucide="plus"></i></button>
                </div>
                <div class="mix-preview">${Object.keys(g).map(cat => `
                    <div class="category-group">
                        <div class="category-header"><span>${cat}</span><span class="badge">${g[cat].length}</span></div>
                        <div class="category-items">${g[cat].map(it => `
                            <div class="mix-item" data-name="${it.name}"><i data-lucide="check"></i><span class="item-text">${it.name}</span><button class="remove-item"><i data-lucide="trash-2"></i></button></div>`).join('')}
                        </div>
                        <div class="cat-add-bar"><input placeholder="在 ${cat} 中添加…" data-cat="${cat}"><button class="icon-btn cat-add-btn" data-cat="${cat}"><i data-lucide="plus"></i></button></div>
                    </div>`).join('')}
                </div>
                <div id="ai-suggestions-container" class="hidden"><h3>AI 建议</h3><div id="ai-list"></div><div class="ai-actions"><button id="accept-ai">采纳</button><button id="discard-ai" class="secondary">不要</button></div></div>
                <div class="mix-actions"><button class="secondary" id="cancel-mix">取消</button><button id="save-mix">保存</button></div>`;
            lucide.createIcons(); setupMixEvents();
        };
        const setupMixEvents = () => {
            $('back-btn').onclick = () => { goBack(); selectedBags.clear(); renderBags(); updateActionCenter(); };
            const addIn = $('add-mix-in');
            const doAdd = () => { const v = addIn.value.trim(); if (!v) return; const [n, c] = v.split('/').map(s => s.trim()); if (!items.some(i => i.name === n)) { items.push({ name: n, category: c || '未分类' }); render(); } };
            addIn.onkeypress = e => { if (e.key === 'Enter') doAdd(); }; $('add-mix-btn').onclick = doAdd;
            document.querySelectorAll('.cat-add-btn').forEach(btn => {
                btn.onclick = e => { e.stopPropagation(); const cat = btn.dataset.cat; const inp = btn.previousElementSibling; const v = inp.value.trim(); if (!v) return; if (!items.some(i => i.name === v)) { items.push({ name: v, category: cat }); render(); } };
            });
            document.querySelectorAll('.cat-add-bar input').forEach(inp => { inp.onkeypress = e => { if (e.key === 'Enter') inp.nextElementSibling.click(); }; });
            document.querySelectorAll('.remove-item').forEach(btn => {
                btn.onclick = e => { e.stopPropagation(); const n = btn.closest('.mix-item').dataset.name; const i = items.findIndex(x => x.name === n); if (i > -1) { items.splice(i, 1); render(); } };
            });
            $('save-mix').onclick = async () => {
                if (!currentUser) return alert("请先登录");
                try { await addDoc(collection(db, 'user_checklists'), { userId: currentUser.uid, name: $('new-bag-name').value, items, checkedItems: [], isStarred: false, tags: ["混合"], createdAt: serverTimestamp() }); selectedBags.clear(); goBack(); renderBags(); updateActionCenter(); } catch (e) { console.error(e); }
            };
            $('cancel-mix').onclick = () => { goBack(); selectedBags.clear(); renderBags(); updateActionCenter(); };
            $('ai-btn').onclick = () => {
                $('ai-btn').disabled = true; $('ai-btn').innerHTML = '<i data-lucide="loader" class="spin"></i>'; lucide.createIcons();
                fetch('/api/ai/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: $('new-bag-name').value, items: items.map(i => i.name) }) }).then(r => r.json()).then(d => {
                    $('ai-suggestions-container').classList.remove('hidden'); $('ai-list').innerHTML = d.suggestions.map(s => `<div class="ai-item">${s}</div>`).join('');
                    $('accept-ai').onclick = () => { d.suggestions.forEach(s => { if (!items.some(i => i.name === s)) items.push({ name: s, category: 'AI建议' }); }); $('ai-suggestions-container').classList.add('hidden'); render(); };
                    $('discard-ai').onclick = () => $('ai-suggestions-container').classList.add('hidden');
                    $('ai-btn').disabled = false; $('ai-btn').innerHTML = '<i data-lucide="sparkles"></i>'; lucide.createIcons();
                });
            };
        };
        render();
    }

    // ===== RENAME =====
    function startRename(bag, renderCb) {
        const h2 = $('bag-title');
        if (!h2) return;
        const input = document.createElement('input');
        input.className = 'glass-input';
        input.value = bag.name;
        input.style.fontSize = '16px';
        h2.replaceWith(input);
        input.focus();
        input.select();
        const save = async () => {
            const newName = input.value.trim();
            if (newName && newName !== bag.name) {
                bag.name = newName;
                if (currentUser) await updateDoc(doc(db, "user_checklists", bag.id), { name: newName });
                renderBags();
            }
            renderCb();
        };
        input.onblur = save;
        input.onkeypress = e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } };
    }

    // ===== OPEN CHECKLIST =====
    function openChecklist(bag) {
        currentOpenBagName = bag.name;
        showRightPanel();

        const render = () => {
            const g = groupItems(bag.items);
            contentView.innerHTML = `
                <div class="checklist-container ${isEditMode ? '' : 'check-mode'}">
                <div class="view-header">
                    <button class="icon-btn" id="back-btn"><i data-lucide="arrow-left"></i></button>
                    <h2 id="bag-title" title="点击重命名">${bag.name}</h2>
                    <div class="view-header-actions">
                        <span id="progress-text">0/0</span>
                        <button class="mode-toggle-btn ${isEditMode ? '' : 'active'}" id="mode-toggle">${isEditMode ? '编辑模式' : '点击模式'}</button>
                        <button class="icon-btn" id="rename-btn" title="重命名"><i data-lucide="pencil"></i></button>
                        <button class="icon-btn dup-btn" id="dup-detail" title="复制"><i data-lucide="copy"></i></button>
                    </div>
                </div>
                <div class="progress-bar-container"><div id="progress-bar" class="progress-bar"></div></div>
                <div class="tag-manage">${(bag.tags || []).map(t => `<span class="badge">${t}<span class="remove-tag" data-tag="${t}">×</span></span>`).join('')}</div>
                <div class="tag-add-row"><input id="tag-input" placeholder="添加标签…"><button class="icon-btn" id="tag-add-btn"><i data-lucide="plus"></i></button></div>
                <div class="checklist-items">${Object.keys(g).map(cat => `
                    <div class="category-group">
                        <div class="category-header"><span>${cat}</span><span class="badge">${g[cat].length}</span></div>
                        <div class="category-items">${g[cat].map(it => {
                const ck = (bag.checkedItems || []).includes(it.name);
                return `<div class="check-item ${ck ? 'checked' : ''}" data-name="${it.name}">
                                <div class="check-box"><i data-lucide="${ck ? 'check' : 'circle'}"></i></div>
                                <span class="item-text">${it.name}</span>
                                <button class="icon-btn delete-item-btn"><i data-lucide="trash-2"></i></button>
                            </div>`;
            }).join('')}
                        </div>
                        <div class="cat-add-bar"><input placeholder="在 ${cat} 中添加…" data-cat="${cat}"><button class="icon-btn cat-add-btn" data-cat="${cat}"><i data-lucide="plus"></i></button></div>
                    </div>`).join('')}
                </div>
                </div>`;
            lucide.createIcons(); updateProgress(bag); setupEvents();
        };

        const setupEvents = () => {
            $('back-btn').onclick = goBack;
            $('dup-detail').onclick = () => duplicateBag(bag);
            $('mode-toggle').onclick = () => { isEditMode = !isEditMode; render(); };

            // Rename
            $('rename-btn').onclick = () => { if (isEditMode) startRename(bag, render); };
            $('bag-title').onclick = () => { if (isEditMode) startRename(bag, render); };

            // Tags
            document.querySelectorAll('.remove-tag').forEach(el => {
                el.onclick = async e => {
                    e.stopPropagation(); bag.tags = (bag.tags || []).filter(t => t !== el.dataset.tag);
                    if (currentUser) await updateDoc(doc(db, "user_checklists", bag.id), { tags: bag.tags });
                    render(); renderTagBar(); renderBags();
                };
            });
            $('tag-add-btn').onclick = async () => {
                const v = $('tag-input').value.trim(); if (!v) return;
                if (!bag.tags) bag.tags = []; if (!bag.tags.includes(v)) bag.tags.push(v);
                if (currentUser) await updateDoc(doc(db, "user_checklists", bag.id), { tags: bag.tags });
                render(); renderTagBar(); renderBags();
            };
            $('tag-input').onkeypress = e => { if (e.key === 'Enter') $('tag-add-btn').click(); };

            // Items
            document.querySelectorAll('.check-item').forEach(el => {
                el.onclick = e => {
                    if (e.target.closest('.delete-item-btn')) { e.stopPropagation(); deleteItem(bag, el.dataset.name, render); }
                    else toggleItem(bag, el.dataset.name, render);
                };
                setupLongPress(el, bag, el.dataset.name, render);
            });

            // Per-category add
            document.querySelectorAll('.cat-add-btn').forEach(btn => {
                btn.onclick = async e => {
                    e.stopPropagation(); const cat = btn.dataset.cat; const inp = btn.previousElementSibling; const v = inp.value.trim(); if (!v) return;
                    if (!bag.items.some(i => (typeof i === 'string' ? i : i.name) === v)) {
                        bag.items.push({ name: v, category: cat });
                        if (currentUser) await updateDoc(doc(db, "user_checklists", bag.id), { items: bag.items });
                        render(); renderBags();
                    }
                };
            });
            document.querySelectorAll('.cat-add-bar input').forEach(inp => { inp.onkeypress = e => { if (e.key === 'Enter') inp.nextElementSibling.click(); }; });
        };
        render();
    }

    async function toggleItem(bag, name, cb) {
        if (!bag.checkedItems) bag.checkedItems = [];
        const i = bag.checkedItems.indexOf(name);
        if (i > -1) bag.checkedItems.splice(i, 1); else bag.checkedItems.push(name);
        cb();
        if (currentUser && userBags.some(b => b.id === bag.id)) await updateDoc(doc(db, "user_checklists", bag.id), { checkedItems: bag.checkedItems });
    }

    async function deleteItem(bag, name, cb) {
        bag.items = bag.items.filter(i => (typeof i === 'string' ? i : i.name) !== name);
        bag.checkedItems = (bag.checkedItems || []).filter(i => i !== name);
        cb();
        if (currentUser && userBags.some(b => b.id === bag.id)) await updateDoc(doc(db, "user_checklists", bag.id), { items: bag.items, checkedItems: bag.checkedItems });
    }

    function updateProgress(bag) {
        const t = bag.items.length, c = (bag.checkedItems || []).length;
        const pt = $('progress-text'), pb = $('progress-bar');
        if (pt) pt.textContent = `${c}/${t}`;
        if (pb) pb.style.width = `${t > 0 ? (c / t) * 100 : 0}%`;
    }

    function resetView() {
        contentView.innerHTML = `<div id="empty-state"><i data-lucide="layout-grid" class="large-icon"></i><p>选择一个清单开始。</p></div>`;
        lucide.createIcons();
    }

    function hideActionCenter() { const ac = $('action-center'); if (ac) ac.remove(); }

    async function loadBags() {
        renderBags(); renderTagBar();
    }

    let unsub = null;
    function loadUserBags() {
        if (!currentUser) return; if (unsub) unsub();
        const q = query(collection(db, "user_checklists"), where("userId", "==", currentUser.uid));
        unsub = onSnapshot(q, snap => { userBags = snap.docs.map(d => ({ id: d.id, ...d.data() })); renderBags(); renderTagBar(); });
    }

    // ===== AI CHATBOT =====
    const chatFab = $('chat-fab'), chatPanel = $('chat-panel'), chatClose = $('chat-close'), chatClear = $('chat-clear');
    const chatInput = $('chat-input'), chatSend = $('chat-send'), chatMessages = $('chat-messages');
    const refreshListsBtn = $('refresh-lists-btn');

    chatFab.onclick = () => { chatPanel.classList.remove('hidden'); chatInput.focus(); chatMessages.scrollTop = chatMessages.scrollHeight; };
    chatClose.onclick = () => chatPanel.classList.add('hidden');
    chatClear.onclick = () => { if (confirm('确定要清空所有聊天记录吗？')) clearChatHistory(); };

    refreshListsBtn.onclick = async () => {
        const icon = refreshListsBtn.querySelector('i');
        icon.classList.add('spin-anim');
        await loadUserBags();
        setTimeout(() => icon.classList.remove('spin-anim'), 600);
    };

    // Handle scroll on focus for mobile keyboard
    chatInput.onfocus = () => {
        if (isMobile()) {
            setTimeout(() => {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }, 300);
        }
    };

    // Resizable Chat Panel
    const resizeHandle = $('chat-resize-handle');
    let isResizing = false;
    let startX, startY, startW, startH;

    resizeHandle.onmousedown = e => {
        if (isMobile()) return;
        isResizing = true;
        startX = e.clientX;
        startY = e.clientY;
        startW = chatPanel.offsetWidth;
        startH = chatPanel.offsetHeight;
        document.body.style.cursor = 'nw-resize';
        e.preventDefault();
    };

    window.addEventListener('mousemove', e => {
        if (!isResizing) return;
        const dw = startX - e.clientX;
        const dh = startY - e.clientY;
        const newW = Math.max(280, startW + dw);
        const newH = Math.max(300, startH + dh);
        chatPanel.style.width = newW + 'px';
        chatPanel.style.height = newH + 'px';
    });

    window.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
        }
    });

    resizeHandle.addEventListener('touchstart', e => {
        if (isMobile()) return;
        isResizing = true;
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
        startW = chatPanel.offsetWidth;
        startH = chatPanel.offsetHeight;
    }, { passive: true });

    window.addEventListener('touchmove', e => {
        if (!isResizing) return;
        const dw = startX - e.touches[0].clientX;
        const dh = startY - e.touches[0].clientY;
        const newW = Math.max(280, startW + dw);
        const newH = Math.max(300, startH + dh);
        chatPanel.style.width = newW + 'px';
        chatPanel.style.height = newH + 'px';
    }, { passive: true });

    window.addEventListener('touchend', () => { isResizing = false; });

    function addChatMsg(text, isUser = false) {
        const el = document.createElement('div');
        el.className = `chat-msg ${isUser ? 'user' : 'bot'}`;
        el.innerHTML = `<span>${text.replace(/\n/g, '<br>')}</span>`;
        chatMessages.appendChild(el);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    async function sendChatMsg() {
        const text = chatInput.value.trim();
        if (!text) return;
        if (!currentUser) { alert('请先登录才能使用 AI'); return; }

        chatInput.value = '';
        chatInput.disabled = true;
        chatSend.disabled = true;

        // Add user message to local history and show immediately
        const userMsg = { role: 'user', text };
        chatHistory.push(userMsg);
        addChatMsg(text, true); // Directly append to DOM — no full re-render
        saveChatHistory();      // Save in background

        const bagsCtx = userBags.map(b => ({ name: b.name, tags: b.tags, items: b.items }));
        const ctx = { bags: bagsCtx, currentBag: currentOpenBagName };

        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text, context: ctx, history: chatHistory.slice(0, -1) })
            });
            const data = await res.json();

            if (data.reply) {
                const botMsg = { role: 'model', text: data.reply };
                chatHistory.push(botMsg);
                addChatMsg(data.reply, false); // Directly append bot reply
                saveChatHistory();
            }

            if (data.actions && data.actions.length > 0) {
                for (let act of data.actions) await executeAction(act);
            }
        } catch (e) {
            console.error(e);
            addChatMsg('抱歉，网络出了点问题。', false);
        } finally {
            chatInput.disabled = false;
            chatSend.disabled = false;
            if (!isMobile()) chatInput.focus(); // Don't re-focus on mobile (causes keyboard/scroll issues)
        }
    }

    async function loadChatHistory() {
        if (!currentUser) return;
        try {
            const snap = await getDoc(doc(db, "ai_chats", currentUser.uid));
            chatHistory = snap.exists() ? (snap.data().messages || []) : [];
        } catch (e) {
            console.warn("Could not load chat history", e);
            chatHistory = [];
        }
        renderChatHistory();
    }

    async function saveChatHistory() {
        if (!currentUser) return;
        try {
            await setDoc(doc(db, "ai_chats", currentUser.uid), { messages: chatHistory });
        } catch (e) { console.error("Save chat error", e); }
    }

    async function clearChatHistory() {
        chatHistory = [];
        await saveChatHistory();
    }

    function renderChatHistory() {
        chatMessages.innerHTML = `
            <div class="chat-msg bot"><span>你好！我是 Mixbag AI 助手 ✨<br><br>试试说：<br>• 「帮我创建一个露营装备清单」<br>• 「把防晒霜加到夏季徒步里」<br>• 「给购物清单加10个水果」</span></div>
        `;
        chatHistory.forEach(msg => {
            const el = document.createElement('div');
            el.className = `chat-msg ${msg.role === 'user' ? 'user' : 'bot'}`;
            el.innerHTML = `<span>${msg.text.replace(/\n/g, '<br>')}</span>`;
            chatMessages.appendChild(el);
        });
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    chatSend.onclick = sendChatMsg;
    chatInput.onkeypress = e => { if (e.key === 'Enter') sendChatMsg(); };

    async function executeAction(act) {
        const getBag = name => userBags.find(b => b.name === name);
        try {
            if (act.type === 'create_list') {
                await addDoc(collection(db, 'user_checklists'), { userId: currentUser.uid, name: act.name, items: act.items || [], checkedItems: [], isStarred: false, tags: act.tags || [], createdAt: serverTimestamp() });
                renderChatHistory();
            }
            else if (act.type === 'add_items') {
                const b = getBag(act.list_name);
                if (b) {
                    const newItms = (act.items || []).map(i => typeof i === 'string' ? { name: i, category: '未分类' } : i);
                    const toAdd = newItms.filter(i => !b.items.some(x => (typeof x === 'string' ? x : x.name) === i.name));
                    if (toAdd.length) {
                        b.items.push(...toAdd);
                        await updateDoc(doc(db, "user_checklists", b.id), { items: b.items });
                        if (currentOpenBagName === b.name) setTimeout(() => openChecklist(b), 100);
                        addChatMsg(`✨ 已向 "${b.name}" 添加 ${toAdd.length} 个项目`, false);
                    }
                }
            }
            else if (act.type === 'remove_items') {
                const b = getBag(act.list_name);
                if (b) {
                    b.items = b.items.filter(i => !(act.item_names || []).includes(typeof i === 'string' ? i : i.name));
                    await updateDoc(doc(db, "user_checklists", b.id), { items: b.items });
                    if (currentOpenBagName === b.name) setTimeout(() => openChecklist(b), 100);
                }
            }
            else if (act.type === 'update_items') {
                const b = getBag(act.list_name);
                if (b) {
                    let changed = false;
                    for (const u of (act.updates || [])) {
                        const idx = b.items.findIndex(i => (typeof i === 'string' ? i : i.name) === u.old_name);
                        if (idx > -1) {
                            const current = b.items[idx];
                            const currentName = typeof current === 'string' ? current : current.name;
                            const currentCat = typeof current === 'string' ? '未分类' : current.category;
                            b.items[idx] = {
                                name: u.new_name || currentName,
                                category: u.new_category || currentCat
                            };

                            // If name changed, we also need to update checkedItems list
                            if (u.new_name && u.new_name !== currentName && (b.checkedItems || []).includes(currentName)) {
                                b.checkedItems = b.checkedItems.filter(x => x !== currentName);
                                b.checkedItems.push(u.new_name);
                                await updateDoc(doc(db, "user_checklists", b.id), { checkedItems: b.checkedItems });
                            }
                            changed = true;
                        }
                    }
                    if (changed) {
                        await updateDoc(doc(db, "user_checklists", b.id), { items: b.items });
                        if (currentOpenBagName === b.name) setTimeout(() => openChecklist(b), 100);
                        addChatMsg(`✨ 已更新 "${b.name}" 中的项目`, false);
                    }
                }
            }
            else if (act.type === 'rename_list') {
                const b = getBag(act.old_name);
                if (b) {
                    await updateDoc(doc(db, "user_checklists", b.id), { name: act.new_name });
                    if (currentOpenBagName === act.old_name) { currentOpenBagName = act.new_name; setTimeout(() => openChecklist({ ...b, name: act.new_name }), 100); }
                }
            }
            else if (act.type === 'delete_list') {
                const b = getBag(act.list_name);
                if (b) { await deleteDoc(doc(db, "user_checklists", b.id)); if (currentOpenBagName === b.name) goBack(); addChatMsg(`✨ 已删除 "${b.name}"`, false); }
            }
            else if (act.type === 'duplicate_list') {
                const b = getBag(act.list_name);
                if (b) {
                    await addDoc(collection(db, 'user_checklists'), { userId: currentUser.uid, name: act.new_name, items: [...b.items], checkedItems: [], isStarred: false, tags: [...(b.tags || [])], createdAt: serverTimestamp() });
                    addChatMsg(`✨ 已复制清单 "${act.new_name}"`, false);
                }
            }
            else if (act.type === 'add_tags') {
                const b = getBag(act.list_name);
                if (b) {
                    const tags = new Set([...(b.tags || []), ...(act.tags || [])]);
                    await updateDoc(doc(db, "user_checklists", b.id), { tags: Array.from(tags) });
                    if (currentOpenBagName === b.name) setTimeout(() => openChecklist(b), 100);
                }
            }
            else if (act.type === 'remove_tags') {
                const b = getBag(act.list_name);
                if (b) {
                    const tags = (b.tags || []).filter(t => !(act.tags || []).includes(t));
                    await updateDoc(doc(db, "user_checklists", b.id), { tags });
                    if (currentOpenBagName === b.name) setTimeout(() => openChecklist(b), 100);
                }
            }
            else if (act.type === 'open_list') {
                const b = getBag(act.list_name);
                if (b) {
                    if (isMobile()) chatPanel.classList.add('hidden');
                    openChecklist(b);
                }
            }
        } catch (e) { console.error("Action error:", e); }
    }

    loadBags();

});
