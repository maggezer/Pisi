// benim-takvimim.js
module.exports = {
    id: 'galaktik_takvim', // Benzersiz bir kimlik
    name: 'Galaktik Takvim', // Menüde görünecek isim
    
    // Takvim ilk açıldığında nereden başlasın?
    getInitialState: () => {
        return { year: 1, month: 1 };
    },
    
    // Arayüzün takvimi çizebilmesi için gerekli verileri hesapla
    getRenderData: (state) => {
        return {
            title: `Galaksi Yılı ${state.year} - Ay ${state.month}`,
            daysInMonth: 40, // Bu takvimde aylar 40 gün çekiyor
            firstDay: 2, // Ayın ilk günü Çarşamba (0=Pzt, 1=Salı, 2=Çar)
            currentYear: state.year,
            currentMonth: state.month,
            isToday: (day) => { return false; } // Şimdilik galaktik "bugün" yok
        };
    },
    
    // İleri okuna basıldığında
    nextMonth: (state) => {
        let m = state.month + 1;
        let y = state.year;
        if (m > 10) { m = 1; y++; } // 1 yılda 10 ay var
        return { year: y, month: m };
    },
    
    // Geri okuna basıldığında
    prevMonth: (state) => {
        let m = state.month - 1;
        let y = state.year;
        if (m < 1) { m = 10; y--; }
        return { year: y, month: m };
    }
};