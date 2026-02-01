#!/usr/bin/env python3
"""
Graph Notes Application
Интерактивное приложение для создания и редактирования заметок в виде графа.
Запускает веб-интерфейс на порту 8799.
"""

import sys
import os
import webbrowser
import json
from threading import Timer

# Добавляем путь для импорта Flask
try:
    from flask import Flask, render_template, jsonify, request
except ImportError:
    print("Ошибка: Flask не установлен. Установите его командой:")
    print("pip install flask")
    sys.exit(1)

# Определение путей для корректной работы приложения
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TEMPLATE_DIR = os.path.join(BASE_DIR, 'templates')
STATIC_DIR = os.path.join(BASE_DIR, 'static')
DATA_FILE = os.path.join(BASE_DIR, 'graph_data.json')

# Инициализация Flask приложения
app = Flask(__name__, 
            template_folder=TEMPLATE_DIR, 
            static_folder=STATIC_DIR)


def load_graph_from_disk():
    """Загрузка данных графа из JSON файла."""
    default_data = {
        "nodes": [],
        "links": []
    }
    
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'r', encoding='utf-8') as f:
                data = json.load(f)
                # Проверяем структуру данных
                if isinstance(data, dict) and 'nodes' in data and 'links' in data:
                    return data
        except (json.JSONDecodeError, IOError) as e:
            print(f"Ошибка загрузки файла данных: {e}")
    
    return default_data


def save_graph_to_disk(data):
    """Сохранение данных графа в JSON файл."""
    try:
        with open(DATA_FILE, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except IOError as e:
        print(f"Ошибка сохранения файла данных: {e}")
        return False


def validate_graph_data(data):
    """
    Валидация и нормализация данных графа.
    Обеспечивает корректность структуры parent/children.
    """
    if not isinstance(data, dict):
        return {"nodes": [], "links": []}
    
    nodes = data.get('nodes', [])
    links = data.get('links', [])
    
    # Создаем словарь узлов для быстрого доступа
    nodes_dict = {}
    for node in nodes:
        if 'id' in node:
            nodes_dict[node['id']] = node
            # Гарантируем наличие полей parentId и children
            if 'parentId' not in node:
                node['parentId'] = None
            if 'children' not in node:
                node['children'] = []
    
    # Восстанавливаем связи children на основе parentId
    for node in nodes:
        parent_id = node.get('parentId')
        if parent_id and parent_id in nodes_dict:
            parent_node = nodes_dict[parent_id]
            if 'children' not in parent_node:
                parent_node['children'] = []
            if node['id'] not in parent_node['children']:
                parent_node['children'].append(node['id'])
    
    # Проверяем корректность ссылок в связях
    node_ids = set(nodes_dict.keys())
    valid_links = []
    for link in links:
        source = link.get('source')
        target = link.get('target')
        if source in node_ids and target in node_ids:
            valid_links.append(link)
    
    return {
        "nodes": nodes,
        "links": valid_links
    }


# Загружаем данные при импорте модуля
graph_data = load_graph_from_disk()


@app.route('/')
def index():
    """Главная страница с интерфейсом графа."""
    return render_template('index.html')


@app.route('/api/graph', methods=['GET', 'POST'])
def handle_graph():
    """API для получения и сохранения состояния графа."""
    global graph_data
    if request.method == 'POST':
        graph_data = request.get_json()
        # Валидируем данные перед сохранением
        graph_data = validate_graph_data(graph_data)
        # Сохраняем на диск
        save_graph_to_disk(graph_data)
        return jsonify({"status": "success", "message": "Graph saved"})
    return jsonify(graph_data)


@app.route('/api/node/<int:node_id>', methods=['GET', 'PUT', 'DELETE'])
def handle_node(node_id):
    """API для управления отдельными узлами."""
    global graph_data
    
    if request.method == 'PUT':
        data = request.get_json()
        for node in graph_data["nodes"]:
            if node["id"] == node_id:
                node.update(data)
                # Валидируем изменения parent/children
                graph_data = validate_graph_data(graph_data)
                # Сохраняем на диск после изменения узла
                save_graph_to_disk(graph_data)
                return jsonify({"status": "success", "node": node})
        return jsonify({"status": "error", "message": "Node not found"}), 404
    
    if request.method == 'DELETE':
        node_to_delete = None
        for node in graph_data["nodes"]:
            if node["id"] == node_id:
                node_to_delete = node
                break
        
        if node_to_delete:
            # Обновляем parentId у детей (делаем их сиротами)
            for node in graph_data["nodes"]:
                if node.get("parentId") == node_id:
                    node["parentId"] = None
            
            # Удаляем из children родителя
            parent_id = node_to_delete.get("parentId")
            if parent_id:
                for node in graph_data["nodes"]:
                    if node["id"] == parent_id and "children" in node:
                        node["children"] = [cid for cid in node["children"] if cid != node_id]
        
        graph_data["nodes"] = [n for n in graph_data["nodes"] if n["id"] != node_id]
        graph_data["links"] = [l for l in graph_data["links"] 
                              if (l.get("source") != node_id and l.get("target") != node_id)]
        
        # Сохраняем на диск после удаления узла
        save_graph_to_disk(graph_data)
        return jsonify({"status": "success"})
    
    # GET request
    for node in graph_data["nodes"]:
        if node["id"] == node_id:
            return jsonify(node)
    return jsonify({"status": "error", "message": "Node not found"}), 404


@app.route('/api/link', methods=['POST'])
def create_link():
    """API для создания связи между узлами."""
    global graph_data
    data = request.get_json()
    
    source_id = data.get('source')
    target_id = data.get('target')
    
    if not source_id or not target_id:
        return jsonify({"status": "error", "message": "Missing source or target"}), 400
    
    # Проверяем существование узлов
    source_exists = any(n["id"] == source_id for n in graph_data["nodes"])
    target_exists = any(n["id"] == target_id for n in graph_data["nodes"])
    
    if not source_exists or not target_exists:
        return jsonify({"status": "error", "message": "Node not found"}), 404
    
    # Проверяем, не существует ли уже такая связь
    link_exists = any(
        (l.get("source") == source_id and l.get("target") == target_id) or
        (l.get("source") == target_id and l.get("target") == source_id)
        for l in graph_data["links"]
    )
    
    if link_exists:
        return jsonify({"status": "error", "message": "Link already exists"}), 400
    
    # Создаем связь
    new_link = {
        "source": source_id,
        "target": target_id,
        "isBreakerLink": data.get('isBreakerLink', False)
    }
    graph_data["links"].append(new_link)
    
    # Сохраняем на диск
    save_graph_to_disk(graph_data)
    
    return jsonify({"status": "success", "link": new_link})


@app.route('/api/reset', methods=['POST'])
def reset_graph():
    """API для сброса графа к начальному состоянию."""
    global graph_data
    graph_data = {
        "nodes": [],
        "links": []
    }
    # Сохраняем пустой граф на диск
    save_graph_to_disk(graph_data)
    return jsonify({"status": "success", "message": "Graph reset"})


@app.route('/api/validate', methods=['POST'])
def validate_graph():
    """API для валидации и нормализации структуры графа."""
    global graph_data
    data = request.get_json() if request.is_json else graph_data
    
    validated_data = validate_graph_data(data)
    
    # Если данные были изменены в процессе валидации, сохраняем
    if validated_data != graph_data:
        graph_data = validated_data
        save_graph_to_disk(graph_data)
    
    return jsonify({
        "status": "success", 
        "message": "Graph validated and normalized",
        "data": graph_data
    })


def open_browser():
    """Открывает браузер с приложением."""
    webbrowser.open_new("http://localhost:8799")


def main():
    """Основная функция запуска приложения."""
    print("=" * 50)
    print("  Graph Notes Application")
    print("  Интерактивный редактор заметок в виде графа")
    print("=" * 50)
    print()
    print("Запуск сервера на http://localhost:8799")
    print("Браузер откроется автоматически...")
    print()
    print("Управление:")
    print("  - Ctrl + ЛКМ по полю: создать точку")
    print("  - ЛКМ по полю: закрыть редактор")
    print("  - ЛКМ по точке: открыть редактор заметок")
    print("  - ПКМ по точке: создать связанную точку")
    print("  - Ctrl + ЛКМ по линии: прервать связь (breaker-узел)")
    print("  - Ctrl + ЛКМ по двум точкам: создать связь между ними")
    print("  - ЛКМ + Тянуть по полю: панонамирование холста")
    print("  - Колёсико мыши: приблизить/отдалить")
    print("  - Ctrl + S: сохранить")
    print()
    print("Новые функции:")
    print("  - Иерархия: parentId и children в JSON")
    print("  - Breaker-узлы: Ctrl+клик на линии создаёт разрыв")
    print("  - Связи: Ctrl+выбор двух узлов создаёт связь")
    print()
    print("Данные сохраняются в файл: graph_data.json")
    print()
    print("Для остановки нажмите Ctrl+C")
    print()
    
    # Таймер для открытия браузера после запуска сервера
    Timer(1.5, open_browser).start()
    
    try:
        app.run(host='0.0.0.0', port=8799, debug=False)
    except KeyboardInterrupt:
        print("\nПриложение остановлено.")
        sys.exit(0)


if __name__ == "__main__":
    main()
