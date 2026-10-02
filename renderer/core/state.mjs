(function initPisiNamespace() {
    const previousPisi = window.Pisi || {};
    const previousState = previousPisi.state || {};

    Object.assign(previousPisi, {
        state: {
            activeCenterNode: previousState.activeCenterNode ?? null,
            centerNodeSaveTimer: previousState.centerNodeSaveTimer ?? null,

            activeMapPath: previousState.activeMapPath ?? null,
            activeMapNodes: previousState.activeMapNodes ?? [],
            activeMapEdges: previousState.activeMapEdges ?? [],
            activeMapCamera: previousState.activeMapCamera ?? { x: 0, y: 0, zoom: 1 },

            activeModalNode: previousState.activeModalNode ?? null,

            mapSaveTimer: previousState.mapSaveTimer ?? null,
            mapCameraSaveTimer: previousState.mapCameraSaveTimer ?? null,

            mapCanvasPanBound: previousState.mapCanvasPanBound ?? false,
            mapZoomEventsBound: previousState.mapZoomEventsBound ?? false,
            mapZoomControlsBound: previousState.mapZoomControlsBound ?? false,

            currentConnectionDrag: previousState.currentConnectionDrag ?? null,
            currentMapBoxSelection: previousState.currentMapBoxSelection ?? null,
            selectedMapEdgeId: previousState.selectedMapEdgeId ?? null,

            collapsedHubPorts: previousState.collapsedHubPorts instanceof Set ? previousState.collapsedHubPorts : new Set(),

            projectRefreshTimer: previousState.projectRefreshTimer ?? null,
            selectedTreeItem: previousState.selectedTreeItem ?? null,

            expandedTreePaths: previousState.expandedTreePaths instanceof Set ? previousState.expandedTreePaths : new Set(),

            suppressFileSystemRefreshUntil: previousState.suppressFileSystemRefreshUntil ?? 0,

            pisiTagsPanelState: previousState.pisiTagsPanelState ?? {
                selectedTag: null,
                index: []
            },

            pisiTagsPanelRefreshTimer: previousState.pisiTagsPanelRefreshTimer ?? null,

            PISI_USER_TAG_CACHE: previousState.PISI_USER_TAG_CACHE instanceof Set ? previousState.PISI_USER_TAG_CACHE : new Set(),

            pisiTagMenuState: previousState.pisiTagMenuState ?? {
                active: false,
                mode: null,
                editor: null,
                command: null,
                items: [],
                selectedIndex: 0,
                todoPriority: null
            },

            openTabs: Array.isArray(previousState.openTabs) ? previousState.openTabs : [],

            activeTabPath: previousState.activeTabPath ?? null,

            pisiCalendarState: previousState.pisiCalendarState ?? null
        },

        api: window.pisiProject,

        ui: previousPisi.ui || {},
        tree: previousPisi.tree || {},
        map: previousPisi.map || {},
        tags: previousPisi.tags || {},
        connections: previousPisi.connections || {},
        calendar: previousPisi.calendar || {}
    });
    window.Pisi = previousPisi;

    function definePisiStateBridge(name) {
        if (Object.prototype.hasOwnProperty.call(window, name)) {
            return;
        }

        Object.defineProperty(window, name, {
            configurable: true,
            get() {
                return window.Pisi.state[name];
            },
            set(value) {
                window.Pisi.state[name] = value;
            }
        });
    }

    [
        'activeMapPath',
        'activeMapNodes',
        'activeMapEdges',
        'activeMapCamera',
        'activeModalNode',

        'mapSaveTimer',
        'mapCameraSaveTimer',

        'mapCanvasPanBound',
        'mapZoomEventsBound',
        'mapZoomControlsBound',

        'currentConnectionDrag',
        'currentMapBoxSelection',
        'selectedMapEdgeId',
        'collapsedHubPorts',

        'projectRefreshTimer',
        'selectedTreeItem',
        'expandedTreePaths',
        'suppressFileSystemRefreshUntil',

        'pisiTagsPanelState',
        'pisiTagsPanelRefreshTimer',
        'PISI_USER_TAG_CACHE',
        'pisiTagMenuState',

        'openTabs',
        'activeTabPath',
        'pisiCalendarState',

        'activeCenterNode',
        'centerNodeSaveTimer'
    ].forEach(definePisiStateBridge);
})();

export {};
