'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('sol panele dock edilen takvim merkez sekmelerin arkasında kalmaz', () => {
    const styles = read('styles/50-tags-and-missions.css');

    assert.match(
        styles,
        /#main-layout > #left-panel \{[\s\S]*?position: relative;[\s\S]*?z-index: 2;[\s\S]*?isolation: isolate;/
    );
    assert.match(
        styles,
        /\.pisi-calendar-dock-zone \{[\s\S]*?position: relative;[\s\S]*?z-index: 1;/
    );
    assert.match(
        styles,
        /\.pisi-calendar\.docked \{[\s\S]*?position: relative;/
    );
});

test('sag panelde yalniz aktif sekme gorunur ve Global Search takvimin ustundeki alanda kalir', () => {
    const styles = read('styles/95-right-search-calendar-fix.css');
    const windowModule = read('renderer/shell/pisi-window.mjs');

    assert.match(
        styles,
        /#right-panel-content > \.right-tab-page \{[\s\S]*?display: none !important;/
    );
    assert.match(
        styles,
        /#right-panel-content > \.right-tab-page\.active \{[\s\S]*?display: block !important;/
    );
    assert.match(
        styles,
        /#right-tab-search\.pisi-search-page\.active \{[\s\S]*?height: 100%;[\s\S]*?display: flex !important;[\s\S]*?overflow: hidden;/
    );
    assert.match(
        styles,
        /#right-tab-search \.pisi-right-search-results \{[\s\S]*?overflow-y: auto;/
    );
    assert.match(
        windowModule,
        /document\.querySelectorAll\('\.right-tab-page'\)[\s\S]*?page\.classList\.toggle/
    );
});

test('Links paneli node adı ve kimlik-yol özet kartını üretmez', () => {
    const links = read('renderer/search/pisi-links-panel.mjs');
    const styles = [
        read('styles/57-search-and-links.css'),
        read('styles/91-light-theme-tuning.css')
    ].join('\n');

    assert.doesNotMatch(links, /pisi-links-summary/);
    assert.doesNotMatch(links, /replaceChildren\(summary,/);
    assert.match(links, /panel\.replaceChildren\(\.\.\.sections\)/);
    assert.doesNotMatch(styles, /pisi-links-summary/);
});
