// Small DOM builder: h('button', { class: 'x', onClick }, 'text').

export function h(tag, props = {}, ...children) {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(props || {})) {
        if (value === null || value === undefined || value === false) continue;
        if (name.startsWith('on') && typeof value === 'function') element.addEventListener(name.slice(2).toLowerCase(), value);
        else if (name === 'class') element.className = value;
        else if (name === 'dataset') Object.assign(element.dataset, value);
        else element.setAttribute(name, value === true ? '' : String(value));
    }
    for (const child of children.flat()) {
        if (child === null || child === undefined || child === false) continue;
        element.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return element;
}
