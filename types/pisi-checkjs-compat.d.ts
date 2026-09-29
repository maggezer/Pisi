// Transitional checkJs compatibility for Pisi's legacy renderer DOM layer.
//
// Pisi predates static DOM typing and many selectors are known by runtime
// contract to resolve to HTML controls even when lib.dom can only infer
// Element/EventTarget. Keep this surface deliberately limited to DOM/event
// affordances used by the current renderer. Application data shapes remain
// type-checked normally.

interface Element {
    readonly dataset: DOMStringMap;
    value: string;
    checked: boolean;
    disabled: boolean;
    hidden: boolean;
    title: string;
    style: CSSStyleDeclaration;
    type: string;
    src: string;
    alt: string;
    placeholder: string;
    tabIndex: number;
    readonly offsetWidth: number;
    readonly offsetHeight: number;
    readonly offsetLeft: number;
    readonly offsetTop: number;
    options: HTMLOptionsCollection;
    __pisiItem?: any;
    pisiPropertyContext?: any;
    focus(options?: FocusOptions): void;
    blur(): void;
    click(): void;
    setCustomValidity(error: string): void;
    reportValidity(): boolean;
    showPicker(): void;
    width: number;
    height: number;
    getContext(contextId: string, options?: any): any;
    getTotalLength(): number;
    getPointAtLength(distance: number): DOMPoint;
}

interface EventTarget {
    closest(selectors: string): Element | null;
    matches(selectors: string): boolean;
    value: string;
}

interface Node {
    matches(selectors: string): boolean;
    querySelector<E extends Element = Element>(selectors: string): E | null;
    querySelectorAll<E extends Element = Element>(selectors: string): NodeListOf<E>;
    readonly dataset: DOMStringMap;
    id: string;
    insertData(offset: number, data: string): void;
}

interface Document {
    matches(selectors: string): boolean;
    closest(selectors: string): Element | null;
    remove(): void;
    readonly options: HTMLOptionsCollection;
}

interface Event {
    readonly detail: any;
    readonly key: string;
    readonly shiftKey: boolean;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly dataTransfer: DataTransfer | null;
    readonly clientX: number;
    readonly clientY: number;
    readonly insertData: string | null;
}

interface Function {
    bound?: boolean;
    timer?: any;
    languageUnsubscribe?: (() => void) | null;
    closeUnsubscribe?: (() => void) | null;
}

interface Error {
    code?: string;
}

interface Navigator {
    readonly userAgentData?: {
        readonly platform?: string;
    };
}
