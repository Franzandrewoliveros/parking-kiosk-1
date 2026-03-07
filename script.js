import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getFirestore, collection, doc, setDoc, getDocs, deleteDoc, addDoc, onSnapshot, writeBatch, getDoc } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDecxXNg2dcSM0rCPN_avxapxCXHfxXOSw",
    authDomain: "metroplaza-13b5e.firebaseapp.com",
    projectId: "metroplaza-13b5e",
    storageBucket: "metroplaza-13b5e.firebasestorage.app",
    messagingSenderId: "958136196486",
    appId: "1:958136196486:web:28292dcd6cd5f2bbfae007"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
let currentUserRole = "guard"; 
let printerCharacteristic = null;
let activeParkingCache = [];

// --- BLUETOOTH ---
window.connectPrinter = async () => {
    try {
        const device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }] });
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
        const characteristics = await service.getCharacteristics();
        printerCharacteristic = characteristics.find(c => c.properties.write);
        document.getElementById('bt-status').innerText = "✅ PRINTER CONNECTED";
        document.getElementById('bt-status').style.background = "#2e7d32";
    } catch (e) { alert("Bluetooth Error: " + e.message); }
};

const printReceipt = async (text) => {
    if (!printerCharacteristic) return false;
    try {
        const encoder = new TextEncoder();
        const data = encoder.encode('\x1B\x40' + text + '\n\n\n\x1D\x56\x41');
        await printerCharacteristic.writeValue(data);
        return true;
    } catch (e) { return false; }
};

// --- AUTH ---
window.enterGuard = () => { currentUserRole = "guard"; loginSuccess("🛡️ GUARD MODE"); };
window.showAdminLogin = () => { document.getElementById('role-selection').style.display = 'none'; document.getElementById('admin-login').style.display = 'block'; };
window.loginAdmin = () => { if(document.getElementById('pass').value === "0526") { currentUserRole = "admin"; loginSuccess("🔑 ADMIN MODE"); } else { alert("Access Denied"); } };
window.backToSelection = () => { document.getElementById('role-selection').style.display = 'block'; document.getElementById('admin-login').style.display = 'none'; };

function loginSuccess(tag) {
    document.getElementById('user-role-tag').innerText = tag;
    document.querySelectorAll('.admin-only').forEach(el => el.style.display = (currentUserRole === "admin") ? 'block' : 'none');
    document.querySelectorAll('.guard-only').forEach(el => el.style.display = (currentUserRole === "guard") ? 'block' : 'none');
    document.getElementById('login-overlay').style.display = 'none';
    document.getElementById('sidebar').style.display = 'flex';
    document.getElementById('main-content').style.display = 'block';
    renderHistory();
    renderSales();
}

// --- CORE LOGIC ---
function formatDuration(ms) {
    const hrs = Math.floor(ms / (1000 * 60 * 60));
    const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    return { text: `${hrs}h ${mins}m`, css: hrs >= 4 ? "dur-danger" : (hrs >= 2 ? "dur-warning" : "dur-safe") };
}

window.checkOut = async (plate) => {
    const data = activeParkingCache.find(d => d.plate === plate);
    if(!data) return;
    
    const outTime = new Date().toLocaleTimeString();
    const hrsElapsed = Math.ceil((Date.now() - data.rawIn) / (1000 * 60 * 60));
    const hrs = Math.max(1, hrsElapsed); 
    let payment = (hrs > 4) ? 20 + (hrs - 4) * 5 : 20;

    await addDoc(collection(db, "parking_history"), { ...data, out: outTime });
    const salesRef = await addDoc(collection(db, "sales_report"), { plate, pay: payment, date: data.date, timestamp: Date.now() });
    const refNo = salesRef.id.substring(0, 8).toUpperCase(); 

    const receiptStr = `\nMETRO PLAZA\nBagong Silang Branch\n-------------------------\nREF NO:    ${refNo}\nPLATE:      ${plate}\nDATE:       ${new Date().toLocaleDateString()}\nTIME IN:    ${data.entryTime}\nTIME OUT:   ${outTime}\nDURATION:   ${hrs} hr(s)\n-------------------------\nTOTAL FEE: P${payment}.00\n-------------------------\nThank you!\n`;
    
    if (!(await printReceipt(receiptStr))) {
        document.getElementById('print-area').innerHTML = `
            <div style="font-family:monospace; text-align:center; width:300px; border:1px solid #000; padding:10px; background:white;">
                <h3>METRO PLAZA</h3><p>Bagong Silang Branch</p><hr>
                <div style="text-align:left;"><b>REF NO: ${refNo}</b><br>PLATE: ${plate}<br>DATE: ${new Date().toLocaleDateString()}<br>TIME IN: ${data.entryTime}<br>TIME OUT: ${outTime}<br>DURATION: ${hrs} hr(s)</div>
                <hr><h2>TOTAL: P${payment}.00</h2><hr><p>Thank you!</p>
            </div>`;
        window.print();
    }
    await deleteDoc(doc(db, "active_parking", plate));
};

// --- ARCHIVE & UTILS ---
window.moveToArchive = async (sourceCol, id) => {
    if(!confirm("Move to Recycle Bin?")) return;
    const docSnap = await getDoc(doc(db, sourceCol, id));
    if (docSnap.exists()) {
        await addDoc(collection(db, "archive"), { ...docSnap.data(), originalCol: sourceCol, deletedAt: new Date().toLocaleString() });
        await deleteDoc(doc(db, sourceCol, id));
    }
};

window.archiveEntireCollection = async (colName) => {
    if(!confirm(`Archive ALL in ${colName}?`)) return;
    const snap = await getDocs(collection(db, colName));
    const batch = writeBatch(db);
    snap.forEach(d => {
        addDoc(collection(db, "archive"), { ...d.data(), originalCol: colName, deletedAt: new Date().toLocaleString() });
        batch.delete(d.ref);
    });
    await batch.commit();
};

window.restoreFromArchive = async (id) => {
    const docSnap = await getDoc(doc(db, "archive", id));
    if (docSnap.exists()) {
        const data = docSnap.data();
        const col = data.originalCol;
        delete data.originalCol; delete data.deletedAt;
        await addDoc(collection(db, col), data);
        await deleteDoc(doc(db, "archive", id));
    }
};

window.finalDelete = async (id) => { if(confirm("Permanently delete?")) await deleteDoc(doc(db, "archive", id)); };
window.clearCollection = async (col) => { if(confirm("EMPTY BIN?")) { const s = await getDocs(collection(db, col)); const b = writeBatch(db); s.forEach(d => b.delete(d.ref)); await b.commit(); }};

// --- KIOSK ---
window.kioskCheckIn = async () => {
    const plate = document.getElementById('kioskPlate').value.trim().toUpperCase();
    if(!plate) return;
    await setDoc(doc(db, "active_parking", plate), { plate, entryTime: new Date().toLocaleTimeString(), rawIn: Date.now(), date: new Date().toLocaleDateString() });
    document.getElementById('kiosk-feedback').innerText = "✅ SUCCESS!";
    document.getElementById('kioskPlate').value = "";
    setTimeout(() => document.getElementById('kiosk-feedback').innerText = "", 2000);
};
window.enterKiosk = () => document.getElementById('kiosk-view').style.display = 'flex';
window.exitKiosk = () => document.getElementById('kiosk-view').style.display = 'none';

// --- RENDERING ---
let historySnap = [];
let salesSnap = [];

const renderHistory = () => {
    document.getElementById('table-hist').innerHTML = historySnap.map(d => {
        const r = d.data();
        const action = (currentUserRole === 'admin') ? `<td><button class="btn-delete" onclick="moveToArchive('parking_history', '${d.id}')">🗑️ Delete</button></td>` : `<td><span class="view-only-tag">View Only</span></td>`;
        return `<tr><td>${r.plate}</td><td>${r.entryTime}</td><td>${r.out}</td><td>${r.date}</td>${action}</tr>`;
    }).reverse().join('');
};

const renderSales = () => {
    let g = 0, t = 0; const todayStr = new Date().toLocaleDateString();
    document.getElementById('table-sale').innerHTML = salesSnap.map(d => {
        const r = d.data(); const refNo = d.id.substring(0, 8).toUpperCase();
        g += Number(r.pay); if(r.date === todayStr) t += Number(r.pay);
        const action = (currentUserRole === 'admin') ? `<td><button class="btn-delete" onclick="moveToArchive('sales_report', '${d.id}')">🗑️ Delete</button></td>` : `<td><span class="view-only-tag">View Only</span></td>`;
        return `<tr><td style="font-family:monospace; color:#666;">#${refNo}</td><td><b>${r.plate}</b></td><td style="color:red; font-weight:bold;">P${r.pay}.00</td><td>${r.date}</td>${action}</tr>`;
    }).reverse().join('');
    document.getElementById('grand-total').innerText = "P" + g.toFixed(2);
    document.getElementById('today-total').innerText = "P" + t.toFixed(2);
};

onSnapshot(collection(db, "active_parking"), snap => {
    activeParkingCache = snap.docs.map(doc => doc.data()).filter(r => r.plate);
    document.getElementById('table-dash').innerHTML = activeParkingCache.map(r => {
        const dur = formatDuration(Date.now() - r.rawIn);
        return `<tr><td><b>${r.plate}</b></td><td>${r.entryTime}</td><td><span class="duration-badge ${dur.css}">${dur.text}</span></td><td><span style="color:green">● PARKED</span></td><td>${r.date}</td><td><button class="btn-release" onclick="checkOut('${r.plate}')">RELEASE</button></td></tr>`;
    }).join('');
});

onSnapshot(collection(db, "parking_history"), snap => { historySnap = snap.docs; renderHistory(); });
onSnapshot(collection(db, "sales_report"), snap => { salesSnap = snap.docs; renderSales(); });
onSnapshot(collection(db, "archive"), snap => {
    document.getElementById('table-arch').innerHTML = snap.docs.map(doc => {
        const r = doc.data();
        return `<tr><td><b>${r.plate}</b></td><td>${r.originalCol.toUpperCase()}</td><td>${r.deletedAt}</td><td><button class="btn-restore" onclick="restoreFromArchive('${doc.id}')">Restore</button><button class="btn-delete" onclick="finalDelete('${doc.id}')">X</button></td></tr>`;
    }).join('');
});

// --- UI UTILS ---
window.filterTable = (id, q) => document.querySelectorAll(`#${id} tr`).forEach(r => r.style.display = r.innerText.toUpperCase().includes(q.toUpperCase()) ? "" : "none");
window.filterByDate = (id, val) => {
    if(!val) return document.querySelectorAll(`#${id} tr`).forEach(r => r.style.display = "");
    const [y, m, d] = val.split('-');
    const fmt = `${parseInt(m)}/${parseInt(d)}/${y}`;
    document.querySelectorAll(`#${id} tr`).forEach(r => r.style.display = r.innerText.includes(fmt) ? "" : "none");
};
window.showTab = (id, el) => {
    document.querySelectorAll('.tab-view').forEach(v => v.style.display = 'none');
    document.getElementById(id).style.display = 'block';
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('view-title').innerText = el.innerText.trim();
};

setInterval(() => { document.getElementById('clock').innerText = new Date().toLocaleString(); }, 1000);
