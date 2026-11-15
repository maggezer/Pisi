// Developer menu only: fills the project with a small sample so the app can be
// tried on a phone before real projects can be transferred. It goes through the
// same repos as everything else, so what lands on disk is ordinary project data.

import { getPisiTodayIsoDate } from '../../../shared/task-model.mjs';

function addDays(date, days) {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return getPisiTodayIsoDate(next);
}

export async function loadSampleProject(project, { now = () => new Date() } = {}) {
    const today = getPisiTodayIsoDate(now());
    const tasks = [
        { title: 'Sabah yürüyüşü', priority: 3, dueDate: today, scheduledAt: `${today}T07:30`, repeat: 'daily' },
        { title: 'TÜBİTAK raporunun yöntem bölümünü gözden geçir', priority: 1, dueDate: today, scheduledAt: `${today}T10:00` },
        { title: 'Market alışverişi', priority: 4, dueDate: today },
        { title: 'Kira ödemesi', priority: 2, dueDate: addDays(now(), -2) },
        { title: 'Haftalık plan toplantısı', priority: 2, dueDate: addDays(now(), 3), scheduledAt: `${addDays(now(), 3)}T14:00`, repeat: 'weekly' },
        { title: 'Okuma listesini düzenle', priority: 5 }
    ];
    const notes = [
        {
            title: 'Pisi Mobil',
            text: 'Pisi Mobil örnek projesi.\n\nBu notlar yalnız deneme içindir; gerçek projen cihazlar arası aktarım geldiğinde yüklenecek.'
        },
        { title: 'Toplantı Notları', text: 'Gündem\n\nMobil veri katmanı, masaüstü uyumluluğu ve örnek proje.\n\nKararlar\n\nHer yazma tek kuyruktan geçer.' },
        { title: 'Işık ve ısı', text: 'Türkçe arama denemesi: IŞIK, ışık, İstanbul, istanbul.' }
    ];

    let addedTasks = 0;
    let addedNotes = 0;
    const existingTitles = new Set((await project.tasks.list()).tasks.map((task) => task.title));
    for (const task of tasks) {
        if (existingTitles.has(task.title)) continue;
        if ((await project.tasks.upsert(task)).ok) addedTasks += 1;
    }
    await project.index.build();
    const noteTitles = new Set(project.notes.list().map((note) => note.title));
    for (const note of notes) {
        if (noteTitles.has(note.title)) continue;
        if ((await project.notes.create(note)).ok) addedNotes += 1;
    }
    const diary = await project.diary.read(today);
    if (!diary.exists) await project.diary.setText(today, 'Örnek proje yüklendi.');
    await project.flush();
    return { tasks: addedTasks, notes: addedNotes };
}
