/**
 * Graph Notes - JavaScript Application
 * Интерактивное приложение для работы с графом заметок
 */

(function() {
    'use strict';

    // ==================== Конфигурация ====================
    const CONFIG = {
        nodeRadius: 18,
        nodeRadiusHover: 22,
        nodeRadiusBreaker: 12,
        chargeStrength: -500,
        linkDistance: 150,
        collisionRadius: 50,
        gravityStrength: 0.05,
        animationDuration: 300,
        zoomMin: 0.1,
        zoomMax: 5,
        colors: {
            root: '#3b82f6',
            child: '#6b7280',
            breaker: '#f59e0b',
            link: '#4a5568',
            linkHover: '#718096',
            selected: '#34d399',
            selectedSource: '#10b981'
        }
    };

    // ==================== Состояние приложения ====================
    const state = {
        nodes: [],
        links: [],
        nextId: 1,
        selectedNode: null,
        // Для создания связей между двумя узлами (Ctrl + клик)
        connectionSourceNode: null,
        simulation: null,
        simplemde: null,
        svg: null,
        width: window.innerWidth,
        height: window.innerHeight,
        // Для отслеживания перетаскивания узлов
        isDragging: false,
        draggedNode: null,
        dragOffsetX: 0,
        dragOffsetY: 0,
        // Для панорамирования холста
        isPanning: false,
        panStartX: 0,
        panStartY: 0,
        // Для масштабирования
        currentZoom: 1,
        zoomTransform: null
    };

    // ==================== DOM элементы ====================
    const elements = {
        graphContainer: null,
        tooltip: null,
        tooltipContent: null,
        editorPanel: null,
        markdownEditor: null,
        editorTitleText: null,
        nodeIdDisplay: null,
        contextDisplay: null,
        instructions: null
    };

    // ==================== Инициализация ====================
    function init() {
        cacheElements();
        initMarkdownEditor();
        initGraph();
        initEventListeners();
        loadGraph();
        hideInstructionsIfNeeded();
    }

    function cacheElements() {
        elements.graphContainer = document.getElementById('graph-container');
        elements.tooltip = document.getElementById('tooltip');
        elements.tooltipContent = document.getElementById('tooltip-content');
        elements.editorPanel = document.getElementById('editor-panel');
        elements.markdownEditor = document.getElementById('markdown-editor');
        elements.editorTitleText = document.getElementById('editor-title-text');
        elements.nodeIdDisplay = document.getElementById('node-id');
        elements.contextDisplay = document.getElementById('context-display');
        elements.instructions = document.getElementById('instructions');
    }

    function initMarkdownEditor() {
        state.simplemde = new SimpleMDE({
            element: elements.markdownEditor,
            spellChecker: false,
            autofocus: false,
            status: false,
            placeholder: 'Напишите вашу заметку здесь...',
            toolbar: [
                'bold', 'italic', 'heading', '|',
                'quote', 'unordered-list', 'ordered-list', '|',
                'link', 'image', '|',
                'preview', 'side-by-side', 'fullscreen'
            ],
            parsingConfig: {
                allowAtxHeaderWithoutSpace: true,
                strikethrough: true,
                tables: true
            },
            renderingConfig: {
                codeSyntaxHighlighting: true
            }
        });

        // Принудительное изменение цвета иконок на белый - через инъекцию стилей
        const style = document.createElement('style');
        style.textContent = `
            .editor-toolbar a { color: #ffffff !important; }
            .editor-toolbar a i { color: #ffffff !important; }
            .editor-toolbar i.fa { color: #ffffff !important; }
        `;
        document.head.appendChild(style);

        // Сохранение при изменении
        state.simplemde.codemirror.on('change', debounce(function() {
            if (state.selectedNode) {
                state.selectedNode.note = state.simplemde.value();
                saveGraph();
            }
        }, 500));
    }

    function initGraph() {
        // Обновляем размеры
        state.width = window.innerWidth;
        state.height = window.innerHeight;

        // Создаем SVG
        state.svg = d3.select('#graph-container')
            .append('svg')
            .attr('width', '100%')
            .attr('height', '100%')
            .on('click', handleBackgroundClick)
            .on('contextmenu', handleBackgroundRightClick);

        // Добавляем группы для слоев (с учетом трансформаций при зуме/панорамировании)
        const svgNode = state.svg.node();
        
        // Группа для всех элементов графа, которая будет трансформироваться
        const graphGroup = state.svg.append('g').attr('class', 'graph-group');

        // Добавляем defs и маркеры
        graphGroup.append('defs').append('marker')
            .attr('id', 'arrowhead')
            .attr('viewBox', '-0 -5 10 10')
            .attr('refX', 25)
            .attr('refY', 0)
            .attr('orient', 'auto')
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .append('path')
            .attr('d', 'M 0,-5 L 10,0 L 0,5')
            .attr('fill', CONFIG.colors.link);

        // Маркер для breaker-связей (прерывистых)
        graphGroup.select('defs').append('marker')
            .attr('id', 'arrowhead-breaker')
            .attr('viewBox', '-0 -5 10 10')
            .attr('refX', 25)
            .attr('refY', 0)
            .attr('orient', 'auto')
            .attr('markerWidth', 6)
            .attr('markerHeight', 6)
            .append('path')
            .attr('d', 'M 0,-5 L 10,0 L 0,5')
            .attr('fill', CONFIG.colors.breaker);

        const linkGroup = graphGroup.append('g').attr('class', 'links');
        const nodeGroup = graphGroup.append('g').attr('class', 'nodes');

        // Инициализация симуляции
        state.simulation = d3.forceSimulation(state.nodes)
            .force('charge', d3.forceManyBody().strength(CONFIG.chargeStrength))
            .force('link', d3.forceLink(state.links)
                .id(d => d.id)
                .distance(CONFIG.linkDistance)
                .strength(0.5))
            .force('center', d3.forceCenter(state.width / 2, state.height / 2)
                .strength(CONFIG.gravityStrength))
            .force('collide', d3.forceCollide()
                .radius(CONFIG.collisionRadius)
                .iterations(3))
            .on('tick', () => tick(linkGroup, nodeGroup));

        // Настройка зума и панорамирования
        const zoom = d3.zoom()
            .scaleExtent([CONFIG.zoomMin, CONFIG.zoomMax])
            .on('zoom', (event) => {
                state.zoomTransform = event.transform;
                state.currentZoom = event.transform.k;
                graphGroup.attr('transform', event.transform);
            })
            .on('start', () => {
                // При начале зума не запускаем симуляцию
            })
            .on('end', () => {
                // После зума перезапускаем симуляцию для плавности
                state.simulation.alpha(0.1).restart();
            });

        // Применяем зум к SVG
        state.svg.call(zoom);
        
        // Сохраняем ссылку на поведение зума
        state.zoom = zoom;

        // Панорамирование при зажатой левой кнопке мыши на фоне
        state.svg
            .on('mousedown', handleSvgMouseDown)
            .on('wheel', handleWheel);

        // Обновляем ссылки на группы в состоянии
        state.linkGroup = linkGroup;
        state.nodeGroup = nodeGroup;
        state.graphGroup = graphGroup;
    }

    function handleSvgMouseDown(event) {
        // Игнорируем клик если это начало перетаскивания узла
        if (event.target.closest('.node')) return;

        // Левая кнопка мыши для панорамирования
        if (event.button === 0) {
            event.preventDefault();
            state.isPanning = true;
            state.panStartX = event.clientX;
            state.panStartY = event.clientY;
            elements.graphContainer.style.cursor = 'grabbing';
        }
    }

    function handleWheel(event) {
        event.preventDefault();
        
        // Получаем текущую трансформацию
        const transform = state.zoomTransform || d3.zoomIdentity;
        
        // Вычисляем новый масштаб
        const zoomFactor = event.deltaY > 0 ? 0.9 : 1.1;
        const newScale = transform.k * zoomFactor;
        
        // Ограничиваем масштаб
        const clampedScale = Math.max(CONFIG.zoomMin, Math.min(CONFIG.zoomMax, newScale));
        
        // Получаем позицию курсора относительно SVG
        const svgElement = state.svg.node();
        const rect = svgElement.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        // Применяем трансформацию с центром в позиции курсора
        const newTransform = transform.translate(
            mouseX - (mouseX - transform.x) * (clampedScale / transform.k),
            mouseY - (mouseY - transform.y) * (clampedScale / transform.k)
        ).scale(clampedScale);
        
        state.svg.transition()
            .duration(150)
            .call(state.zoom.transform, newTransform);
    }

    function initEventListeners() {
        // Закрытие редактора
        document.getElementById('close-editor').addEventListener('click', closeEditor);
        
        // Сохранение вручную
        document.getElementById('save-note').addEventListener('click', () => {
            saveGraph();
            showNotification('Сохранено');
        });

        // Удаление узла
        document.getElementById('delete-node').addEventListener('click', deleteSelectedNode);

        // Скрытие инструкций
        document.getElementById('hide-instructions').addEventListener('click', () => {
            elements.instructions.classList.add('hidden');
            localStorage.setItem('graph-notes-instructions-hidden', 'true');
        });

        // Горячие клавиши
        document.addEventListener('keydown', handleKeydown);

        // Изменение размера окна
        window.addEventListener('resize', handleResize);

        // Глобальные обработчики для перетаскивания и панорамирования
        document.addEventListener('mousemove', handleGlobalMouseMove);
        document.addEventListener('mouseup', handleGlobalMouseUp);
    }

    // ==================== Обработчики событий ====================
    function handleBackgroundClick(event) {
        if (event.target.tagName !== 'svg') return;
        
        // Если зажат Ctrl - создаем новую точку
        if (event.ctrlKey) {
            event.preventDefault();
            const coords = getSVGCoordinates(event);
            createNode(coords.x, coords.y, 'root');
            return;
        }
        
        // Сбрасываем выбор для создания связи, если кликнули на фон
        if (state.connectionSourceNode) {
            clearConnectionSelection();
        }
        
        // Если редактор открыт, закрываем его
        if (elements.editorPanel.classList.contains('active')) {
            closeEditor();
            return;
        }
    }

    function handleBackgroundRightClick(event) {
        event.preventDefault(); // Блокируем стандартное контекстное меню
        
        // Проверяем, нажат ли Ctrl
        if (event.ctrlKey) {
            // Игнорируем, если в данный момент происходит перетаскивание или панорамирование
            if (state.isDragging || state.isPanning) return;

            // Получаем координаты с учетом масштаба и создаем узел
            const coords = getSVGCoordinates(event);
            createNode(coords.x, coords.y, 'root');
        }
    }

    function handleNodeClick(event, d) {
        event.stopPropagation();
        
        // Игнорируем клик если было перетаскивание
        if (state.isDragging) return;
        
        // Обработка создания связи при зажатом Ctrl
        if (event.ctrlKey) {
            handleCtrlClickForConnection(d);
            return;
        }
        
        // Обычный клик - открываем редактор
        selectNode(d);
    }

    // Обработка Ctrl+клик для создания связи между узлами
    function handleCtrlClickForConnection(clickedNode) {
        // Если это тот же узел, который уже выбран - сбрасываем выбор
        if (state.connectionSourceNode && state.connectionSourceNode.id === clickedNode.id) {
            clearConnectionSelection();
            showNotification('Выбор отменён');
            return;
        }
        
        // Если есть уже выбранный узел-источник - создаём связь
        if (state.connectionSourceNode) {
            createLink(state.connectionSourceNode, clickedNode);
            showNotification(`Связь создана: #${state.connectionSourceNode.id} → #${clickedNode.id}`);
            clearConnectionSelection();
            return;
        }
        
        // Иначе устанавливаем текущий узел как источник для связи
        setConnectionSource(clickedNode);
        showNotification(`Выбран узел #${clickedNode.id}. Кликните на другой узел для создания связи.`);
    }

    // Установка узла как источника для создания связи
    function setConnectionSource(node) {
        // Сбрасываем предыдущий выбор
        if (state.connectionSourceNode) {
            d3.select(`#node-${state.connectionSourceNode.id}`)
                .classed('connection-source', false)
                .select('circle')
                .transition()
                .duration(200)
                .attr('stroke-width', 0);
        }
        
        state.connectionSourceNode = node;
        
        // Визуально выделяем новый источник
        d3.select(`#node-${node.id}`)
            .classed('connection-source', true)
            .select('circle')
            .transition()
            .duration(200)
            .attr('stroke', CONFIG.colors.selectedSource)
            .attr('stroke-width', 4);
    }

    // Сброс выбора источника связи
    function clearConnectionSelection() {
        if (state.connectionSourceNode) {
            d3.select(`#node-${state.connectionSourceNode.id}`)
                .classed('connection-source', false)
                .select('circle')
                .transition()
                .duration(200)
                .attr('stroke-width', 0);
            state.connectionSourceNode = null;
        }
    }

    function handleNodeRightClick(event, d) {
        event.preventDefault();
        event.stopPropagation();
        
        // Игнорируем если было перетаскивание
        if (state.isDragging) return;
        
        // Сбрасываем выбор для создания связи
        clearConnectionSelection();
        
        // Создаем дочерний узел на расстоянии от родителя
        const angle = Math.random() * 2 * Math.PI;
        const distance = CONFIG.linkDistance; // 150px от родителя
        const newNode = createNode(
            d.x + Math.cos(angle) * distance,
            d.y + Math.sin(angle) * distance,
            'child',
            d.id // передаём ID родительского узла
        );
        
        // Создаем связь
        createLink(d, newNode);
        
        // Добавляем визуальный эффект
        pulseNode(newNode);
    }

    function handleNodeMouseDown(event, d) {
        // Левая кнопка мыши (button 0) для перетаскивания узла
        if (event.button === 0) { 
            event.stopPropagation();
            
            state.isDragging = true;
            state.draggedNode = d;
            
            // Фиксируем координаты узла, чтобы симуляция их не меняла
            d.fx = d.x;
            d.fy = d.y;
            
            state.dragOffsetX = 0;
            state.dragOffsetY = 0;

            state.simulation.alphaTarget(0.3).restart();
        }
    }

    function handleGlobalMouseMove(event) {
        // Перетаскивание узла
        if (state.isDragging && state.draggedNode) {
            const coords = getSVGCoordinates(event);
            state.draggedNode.fx = coords.x;
            state.draggedNode.fy = coords.y;
        }
        
        // Панонамирование холста
        if (state.isPanning) {
            const dx = event.clientX - state.panStartX;
            const dy = event.clientY - state.panStartY;
            
            const transform = state.zoomTransform || d3.zoomIdentity;
            const newTransform = transform.translate(dx, dy);
            
            state.svg.call(state.zoom.transform, newTransform);
            
            state.panStartX = event.clientX;
            state.panStartY = event.clientY;
        }
    }

    function handleGlobalMouseUp(event) {
        // Завершение перетаскивания узла
        if (state.isDragging && state.draggedNode) {
            state.draggedNode.fx = null; // Позволяет силам снова влиять на узел
            state.draggedNode.fy = null;
            
            state.simulation.alphaTarget(0);
            state.isDragging = false;
            state.draggedNode = null;
        }
        
        // Завершение панонамирования
        if (state.isPanning) {
            state.isPanning = false;
            elements.graphContainer.style.cursor = 'crosshair';
        }
    }

    function handleKeydown(event) {
        // Escape - закрыть редактор и сбрасывать выбор связи
        if (event.key === 'Escape') {
            closeEditor();
            clearConnectionSelection();
        }
        
        // Ctrl+S - сохранить
        if (event.ctrlKey && event.key === 's') {
            event.preventDefault();
            saveGraph();
            showNotification('Сохранено');
        }
        
        // Delete - удалить выбранный узел
        if (event.key === 'Delete' && state.selectedNode) {
            deleteSelectedNode();
        }
    }

    function handleResize() {
        state.width = window.innerWidth;
        state.height = window.innerHeight;
        
        state.simulation.force('center', d3.forceCenter(state.width / 2, state.height / 2));
        state.simulation.alpha(0.3).restart();
    }

    // ==================== Утилиты для координат ====================
    function getSVGCoordinates(event) {
        const svgElement = state.svg.node();
        const rect = svgElement.getBoundingClientRect();
        
        // Получаем координаты в системе координат SVG с учетом трансформаций
        const transform = state.zoomTransform || d3.zoomIdentity;
        
        // Преобразуем координаты экрана в координаты внутри SVG с учетом трансформации
        const x = (event.clientX - rect.left - transform.x) / transform.k;
        const y = (event.clientY - rect.top - transform.y) / transform.k;
        
        return { x, y };
    }

    // ==================== Операции с графом ====================
    function createNode(x, y, type, parentId = null) {
        const node = {
            id: state.nextId++,
            x: x,
            y: y,
            fx: null,
            fy: null,
            type: type,
            note: type === 'root' ? '# Новая заметка\n\nНачните писать...' : '',
            createdAt: new Date().toISOString(),
            parentId: parentId, // ID родительского элемента
            children: [] // Массив ID дочерних элементов
        };
        
        state.nodes.push(node);
        restart();
        return node;
    }

    function createLink(source, target, isBreakerLink = false) {
        const link = {
            source: source,
            target: target,
            id: `${source.id}-${target.id}`,
            isBreakerLink: isBreakerLink // Флаг для связи через breaker-узел
        };
        
        state.links.push(link);
        restart();
        
        // Увеличиваем "расплывание" при добавлении новых связей
        state.simulation.force('charge', d3.forceManyBody()
            .strength(CONFIG.chargeStrength * Math.min(state.links.length / 5, 2)));
        state.simulation.alpha(0.5).restart();
    }

    // Создание breaker-узла на линии (разрывающая разметка)
    function createBreakerOnLine(linkData) {
        const sourceNode = typeof linkData.source === 'object' ? linkData.source : state.nodes.find(n => n.id === linkData.source);
        const targetNode = typeof linkData.target === 'object' ? linkData.target : state.nodes.find(n => n.id === linkData.target);
        
        if (!sourceNode || !targetNode) return null;
        
        // Вычисляем середину линии
        const midX = (sourceNode.x + targetNode.x) / 2;
        const midY = (sourceNode.y + targetNode.y) / 2;
        
        // Удаляем старую связь
        state.links = state.links.filter(l => l.id !== linkData.id);
        
        // Создаем breaker-узел
        const breakerNode = createNode(midX, midY, 'breaker');
        breakerNode.note = '# Разрывающая связь\n\nСвязь была прервана в этой точке.';
        
        // Создаем две новые связи через breaker
        createLink(sourceNode, breakerNode, true);
        createLink(breakerNode, targetNode, true);
        
        // Визуальный эффект
        pulseNode(breakerNode);
        showNotification('Связь прервана: создан breaker-узел');
        
        return breakerNode;
    }

    // Обновление связей при изменении parent/children
    function updateParentChildRelationships(parentNode, childNode, isAdding = true) {
        if (isAdding) {
            // Добавляем ребенка в родителя
            if (parentNode && childNode) {
                parentNode.children.push(childNode.id);
                childNode.parentId = parentNode.id;
            }
        } else {
            // Удаляем ребенка из родителя
            if (parentNode && childNode) {
                parentNode.children = parentNode.children.filter(id => id !== childNode.id);
                childNode.parentId = null;
            }
        }
    }

    function selectNode(node) {
        // Снимаем выделение с предыдущего
        if (state.selectedNode) {
            d3.selectAll('.node')
                .classed('selected', false)
                .select('circle')
                .transition()
                .duration(200)
                .attr('r', CONFIG.nodeRadius);
        }
        
        state.selectedNode = node;
        
        // Выделяем текущий
        d3.select(`#node-${node.id}`)
            .classed('selected', true)
            .select('circle')
            .transition()
            .duration(200)
            .attr('r', CONFIG.nodeRadiusHover);
        
        // Открываем редактор
        openEditor(node);
    }

    function deleteSelectedNode() {
        if (!state.selectedNode) return;
        
        const nodeId = state.selectedNode.id;
        const parentId = this.parentId;
        
        // Находим родительский узел для обновления children
        const parentNode = state.nodes.find(n => n.id === node.parentId);
        
        // Удаляем связи
        state.links = state.links.filter(link => {
            const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
            const targetId = typeof link.target === 'object' ? link.target.id : link.target;
            return sourceId !== nodeId && targetId !== nodeId;
        });
        
        // Обновляем children у родителя
        if (parentNode) {
            parentNode.children = parentNode.children.filter(id => id !== nodeId);
        }
        
        // Обновляем parentId у детей (делаем их сиротами)
        state.nodes.forEach(n => {
            if (n.parentId === nodeId) {
                n.parentId = null;
            }
        });
        
        // Удаляем узел
        state.nodes = state.nodes.filter(n => n.id !== nodeId);
        
        // Закрываем редактор
        closeEditor();
        
        // Перезапускаем
        restart();
        saveGraph();
        
        showNotification('Узел удален');
    }

    // ==================== Получение контекста из связанных нод ====================
    function getNodeContext(node) {
        const MAX_CHARS = 400;
        let contextParts = [];
        
        // Получаем текст родительской ноды
        if (node.parentId) {
            const parentNode = state.nodes.find(n => n.id === node.parentId);
            if (parentNode && parentNode.note && parentNode.note.trim()) {
                const noteText = parentNode.note.trim();
                const displayText = noteText.length > MAX_CHARS 
                    ? '...' + noteText.substring(noteText.length - MAX_CHARS)
                    : noteText;
                contextParts.push({
                    label: `От родителя #${parentNode.id}:`,
                    text: displayText
                });
            }
        }
        
        // Получаем текст дочерних нод (если есть)
        if (node.children && node.children.length > 0) {
            node.children.forEach(childId => {
                const childNode = state.nodes.find(n => n.id === childId);
                if (childNode && childNode.note && childNode.note.trim()) {
                    const noteText = childNode.note.trim();
                    const displayText = noteText.length > MAX_CHARS 
                        ? '...' + noteText.substring(noteText.length - MAX_CHARS)
                        : noteText;
                    contextParts.push({
                        label: `От дочерней #${childNode.id}:`,
                        text: displayText
                    });
                }
            });
        }
        
        return contextParts;
    }

    function updateContextDisplay(node) {
        const contextParts = getNodeContext(node);
        
        if (contextParts.length === 0) {
            elements.contextDisplay.innerHTML = '';
            return;
        }
        
        let html = '';
        contextParts.forEach(part => {
            html += `<div class="context-label">${escapeHtml(part.label)}</div>`;
            html += `<div class="context-text">${escapeHtml(part.text)}</div>`;
            html += '<br>';
        });
        
        elements.contextDisplay.innerHTML = html;
    }

    // ==================== Редактор ====================
    function openEditor(node) {
        elements.editorPanel.classList.add('active');
        elements.editorTitleText.textContent = `Заметка #${node.id}`;
        
        // Определяем тип узла для отображения
        let nodeTypeText = 'Основная точка';
        if (node.type === 'child') {
            nodeTypeText = node.parentId ? `Дочерняя (от #${node.parentId})` : 'Дочерняя';
        } else if (node.type === 'breaker') {
            nodeTypeText = 'Разрывающая связь';
        }
        
        elements.nodeIdDisplay.textContent = `Тип: ${nodeTypeText}`;
        
        // Обновляем контекст из родительской и дочерней ноды
        updateContextDisplay(node);
        
        state.simplemde.value(node.note || '');
        state.simplemde.codemirror.focus();
    }

    function closeEditor() {
        elements.editorPanel.classList.remove('active');
        
        if (state.selectedNode) {
            // Снимаем выделение
            d3.select(`#node-${state.selectedNode.id}`)
                .classed('selected', false)
                .select('circle')
                .transition()
                .duration(200)
                .attr('r', CONFIG.nodeRadius);
            
            state.selectedNode = null;
        }
        
        // Сохраняем перед закрытием
        saveGraph();
    }

    // ==================== Визуализация ====================
    function tick(linkGroup, nodeGroup) {
        // Обновляем линии
        linkGroup.selectAll('line')
            .attr('x1', d => d.source.x)
            .attr('y1', d => d.source.y)
            .attr('x2', d => d.target.x)
            .attr('y2', d => d.target.y);
        
        // Обновляем узлы
        nodeGroup.selectAll('.node')
            .attr('transform', d => `translate(${d.x}, ${d.y})`);
    }

    function restart() {
        const linkGroup = state.svg.select('.links');
        const nodeGroup = state.svg.select('.nodes');
        
        // Обновление линий
        const links = linkGroup.selectAll('line')
            .data(state.links, d => d.id || `${d.source.id}-${d.target.id}`);
        
        links.exit().remove();
        
        const linksEnter = links.enter()
            .append('line')
            .attr('class', d => d.isBreakerLink ? 'link link-breaker' : 'link')
            .on('click', handleLinkClick)
            .on('mouseover', handleLinkMouseOver)
            .on('mouseout', handleLinkMouseOut);
        
        linksEnter.merge(links);
        
        // Обновление узлов
        const nodes = nodeGroup.selectAll('.node')
            .data(state.nodes, d => d.id);
        
        nodes.exit()
            .transition()
            .duration(CONFIG.animationDuration)
            .attr('r', 0)
            .remove();
        
        const nodesEnter = nodes.enter()
            .append('g')
            .attr('class', d => `node ${d.type}`)
            .attr('id', d => `node-${d.id}`)
            .call(d3.drag()
                .on("start", dragstarted)
                .on("drag", dragged)
                .on("end", dragended));
        
        nodesEnter
            .append('circle')
            .attr('class', 'node-circle')
            .attr('r', 0)
            .transition()
            .duration(CONFIG.animationDuration)
            .attr('r', d => d.type === 'breaker' ? CONFIG.nodeRadiusBreaker : CONFIG.nodeRadius);
        
        nodesEnter
            .on('click', handleNodeClick)
            .on('contextmenu', handleNodeRightClick)
            .on('mousedown', handleNodeMouseDown)
            .on('mouseover', showTooltip)
            .on('mouseout', hideTooltip);
        
        nodesEnter.merge(nodes);
        
        // Перезапуск симуляции
        state.simulation.nodes(state.nodes);
        state.simulation.force('link').links(state.links);
        state.simulation.alpha(1).restart();
    }

    // Обработка клика по линии для создания breaker-узла
    function handleLinkClick(event, d) {
        event.stopPropagation();
        
        if (event.ctrlKey) {
            // Создаем breaker-узел на этой линии
            createBreakerOnLine(d);
        }
    }

    // Обработка наведения на линию
    function handleLinkMouseOver(event, d) {
        d3.select(event.target)
            .classed('link-hover', true);
    }

    // Обработка ухода с линии
    function handleLinkMouseOut(event, d) {
        d3.select(event.target)
            .classed('link-hover', false);
    }

    function pulseNode(node) {
        d3.select(`#node-${node.id}`)
            .append('circle')
            .attr('class', 'node-pulse')
            .attr('r', CONFIG.nodeRadius)
            .attr('fill', 'none')
            .attr('stroke', CONFIG.colors[node.type] || CONFIG.colors.root)
            .attr('stroke-width', 2)
            .attr('cx', 0)
            .attr('cy', 0)
            .transition()
            .duration(500)
            .remove();
    }

    // ==================== Tooltip ====================
    function showTooltip(event, d) {
        const noteText = d.note ? d.note.trim() : '';
        const preview = noteText ? 
            noteText.substring(0, 100) + (noteText.length > 100 ? '...' : '') : 
            'Пустая заметка';
        
        let nodeType = 'Основная точка';
        if (d.type === 'child') {
            nodeType = d.parentId ? `Дочерняя (от #${d.parentId})` : 'Дочерняя';
        } else if (d.type === 'breaker') {
            nodeType = 'Разрывающая связь';
        }
        
        elements.tooltipContent.innerHTML = `
            <div class="node-type">${nodeType} #${d.id}</div>
            <div class="note-preview ${!noteText ? 'empty-note' : ''}">${escapeHtml(preview)}</div>
        `;
        
        elements.tooltip.classList.remove('hidden');
        
        // Позиционирование с учетом трансформаций
        requestAnimationFrame(() => {
            const tooltipRect = elements.tooltip.getBoundingClientRect();
            const transform = state.zoomTransform || d3.zoomIdentity;
            
            let x = event.pageX + 15;
            let y = event.pageY + 15;
            
            // Не выходить за границы экрана
            if (x + tooltipRect.width > window.innerWidth) {
                x = event.pageX - tooltipRect.width - 15;
            }
            if (y + tooltipRect.height > window.innerHeight) {
                y = event.pageY - tooltipRect.height - 15;
            }
            
            elements.tooltip.style.left = `${x}px`;
            elements.tooltip.style.top = `${y}px`;
            elements.tooltip.classList.add('visible');
        });
    }

    function hideTooltip() {
        elements.tooltip.classList.remove('visible');
        setTimeout(() => {
            if (!elements.tooltip.classList.contains('visible')) {
                elements.tooltip.classList.add('hidden');
            }
        }, 200);
    }

    // ==================== API и хранилище ====================
    function saveGraph() {
        const data = {
            nodes: state.nodes.map(n => ({
                id: n.id,
                type: n.type,
                note: n.note,
                x: n.x,
                y: n.y,
                createdAt: n.createdAt,
                parentId: n.parentId, // ID родительского элемента
                children: n.children || [] // Массив ID дочерних элементов
            })),
            links: state.links.map(l => ({
                source: l.source.id,
                target: l.target.id,
                isBreakerLink: l.isBreakerLink || false
            }))
        };
        
        fetch('/api/graph', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(data)
        }).catch(err => console.error('Ошибка сохранения:', err));
    }

    function loadGraph() {
        fetch('/api/graph')
            .then(response => response.json())
            .then(data => {
                if (data.nodes && data.nodes.length > 0) {
                    state.nodes = data.nodes.map(n => ({
                        ...n,
                        x: n.x || (state.width / 2 + (Math.random() - 0.5) * 200),
                        y: n.y || (state.height / 2 + (Math.random() - 0.5) * 200),
                        fx: null,
                        fy: null,
                        parentId: n.parentId || null,
                        children: n.children || []
                    }));
                    
                    state.links = data.links.map(l => ({
                        source: state.nodes.find(n => n.id === l.source),
                        target: state.nodes.find(n => n.id === l.target),
                        id: `${l.source}-${l.target}`,
                        isBreakerLink: l.isBreakerLink || false
                    })).filter(l => l.source && l.target);
                    
                    state.nextId = Math.max(...state.nodes.map(n => n.id)) + 1;
                    restart();
                }
            })
            .catch(err => console.error('Ошибка загрузки:', err));
    }

    // ==================== Утилиты ====================
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function showNotification(message) {
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: #34d399;
            color: #1e1e1e;
            padding: 12px 24px;
            border-radius: 8px;
            font-weight: 500;
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;
        
        document.body.appendChild(notification);
        
        setTimeout(() => {
            notification.style.animation = 'fadeOut 0.3s ease forwards';
            setTimeout(() => notification.remove(), 300);
        }, 2000);
    }

    function hideInstructionsIfNeeded() {
        if (localStorage.getItem('graph-notes-instructions-hidden')) {
            elements.instructions.classList.add('hidden');
        }
    }

    function dragstarted(event, d) {
        if (!event.active) state.simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
        state.isDragging = true;
        state.draggedNode = d;
    }

    function dragged(event, d) {
        d.fx = event.x;
        d.fy = event.y;
    }

    function dragended(event, d) {
        if (!event.active) state.simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
        state.isDragging = false;
        state.draggedNode = null;
    }

    // ==================== Добавление CSS анимаций ====================
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeOut {
            from { opacity: 1; }
            to { opacity: 0; }
        }
    `;
    document.head.appendChild(style);

    // ==================== Запуск ====================
    document.addEventListener('DOMContentLoaded', init);

})();
