'use strict';

// ===== State =====
let characterData = null;
let currentCombo   = [];
let currentCategory = 'all';
let searchQuery    = '';

const STORAGE_KEY = 'sf6_combo_lab';

// ===== Init =====
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  renderSavedList();
  loadCharacter(document.getElementById('character').value);
});

// ===== Event listeners =====
function setupEventListeners() {
  document.getElementById('character').addEventListener('change', e => {
    currentCombo = [];
    loadCharacter(e.target.value);
    renderCombo();
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentCategory = btn.dataset.category;
      renderMoveList();
    });
  });

  document.getElementById('move-search').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderMoveList();
  });

  document.getElementById('add-normal-rush').addEventListener('click', () => {
    currentCombo.push({ type: 'rush', rushType: 'normal' });
    renderCombo();
  });

  document.getElementById('add-cancel-dr').addEventListener('click', () => {
    currentCombo.push({ type: 'rush', rushType: 'cancel' });
    renderCombo();
  });

  document.getElementById('clear-combo').addEventListener('click', () => {
    if (currentCombo.length === 0) return;
    currentCombo = [];
    renderCombo();
  });

  document.getElementById('save-combo').addEventListener('click', () => {
    const name = document.getElementById('combo-name').value.trim();
    if (!name) { alert('コンボ名を入力してください'); return; }
    if (currentCombo.length === 0) { alert('コンボが空です'); return; }
    saveCombo(name);
    document.getElementById('combo-name').value = '';
  });
}

// ===== Character data =====
async function loadCharacter(char) {
  const moveListEl = document.getElementById('move-list');
  moveListEl.innerHTML = '<p class="no-data">読み込み中...</p>';
  try {
    const res = await fetch(`data/${char}.json`);
    if (!res.ok) throw new Error('Not found');
    characterData = await res.json();
    renderMoveList();
  } catch {
    characterData = null;
    moveListEl.innerHTML =
      `<p class="no-data">フレームデータが見つかりません。<br>data/${escapeHtml(char)}.json を配置してください。</p>`;
  }
}

function getMoveMap() {
  if (!characterData) return {};
  const map = {};
  for (const m of characterData.moves) map[m.id] = m;
  return map;
}

// ===== Move list =====
function renderMoveList() {
  const el = document.getElementById('move-list');
  if (!characterData) return;

  let moves = characterData.moves;
  if (currentCategory !== 'all') {
    moves = moves.filter(m => m.category === currentCategory);
  }
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    moves = moves.filter(m =>
      m.name.includes(searchQuery) ||
      m.fullName.includes(searchQuery) ||
      m.id.toLowerCase().includes(q)
    );
  }

  if (moves.length === 0) {
    el.innerHTML = '<p class="no-data">該当する技がありません</p>';
    return;
  }

  el.innerHTML = moves.map(m => `
    <button class="move-btn cat-${m.category}" data-id="${m.id}" title="${escapeHtml(m.fullName)}">
      <span class="move-name">${escapeHtml(m.name)}</span>
      <span class="move-damage">${m.damage}</span>
    </button>
  `).join('');

  el.querySelectorAll('.move-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentCombo.push({ type: 'move', moveId: btn.dataset.id });
      renderCombo();
    });
  });
}

// ===== Combo builder =====
function renderCombo() {
  const el = document.getElementById('combo-list');
  const moveMap = getMoveMap();

  if (currentCombo.length === 0) {
    el.innerHTML = '<p class="empty-combo">技を選択してコンボを組み立てましょう</p>';
    renderResults(null);
    return;
  }

  el.innerHTML = currentCombo.map((entry, i) => {
    const isFirst = i === 0;
    const isLast  = i === currentCombo.length - 1;
    let label, cls;

    if (entry.type === 'rush') {
      label = entry.rushType === 'cancel' ? 'キャンセルDR' : '生ラッシュ';
      cls   = `combo-entry ${entry.rushType === 'cancel' ? 'cancel-dr' : 'normal-rush'}`;
    } else {
      const m = moveMap[entry.moveId];
      label = m ? escapeHtml(m.name) : escapeHtml(entry.moveId);
      cls   = `combo-entry cat-${m ? m.category : 'unknown'}`;
    }

    return `<div class="${cls}">
      <span class="entry-idx">${i + 1}</span>
      <span class="entry-label">${label}</span>
      <div class="entry-controls">
        <button class="ctrl-btn up"     data-i="${i}" ${isFirst ? 'disabled' : ''}>&#8593;</button>
        <button class="ctrl-btn down"   data-i="${i}" ${isLast  ? 'disabled' : ''}>&#8595;</button>
        <button class="ctrl-btn remove" data-i="${i}">&#215;</button>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.ctrl-btn.up').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i;
      [currentCombo[i - 1], currentCombo[i]] = [currentCombo[i], currentCombo[i - 1]];
      renderCombo();
    });
  });
  el.querySelectorAll('.ctrl-btn.down').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = +btn.dataset.i;
      [currentCombo[i], currentCombo[i + 1]] = [currentCombo[i + 1], currentCombo[i]];
      renderCombo();
    });
  });
  el.querySelectorAll('.ctrl-btn.remove').forEach(btn => {
    btn.addEventListener('click', () => {
      currentCombo.splice(+btn.dataset.i, 1);
      renderCombo();
    });
  });

  renderResults(calculateCombo(currentCombo, moveMap));
}

// ===== Calculation =====
/*
 * ダメージ計算ロジック（CLAUDE.md 準拠）
 *
 * 加算系補正の適用ルール（合計が90を超えた場合は90に置換）：
 *   - 基本コンボ補正    : 3段目から毎段 +10
 *   - 通常始動補正      : 1段目に特殊始動補正がない場合、3段目に一度だけ +10
 *   - 特殊始動補正      : 1段目に startupCorrection がある場合、2段目に一度だけ +startupCorrection
 *   - 追加コンボ補正    : comboCorrection > 0 の技の次の段に (comboCorrection - 10) を加算
 *   - 即時補正          : 2段目以降、instantCorrectionCondition の条件を満たす場合にその段自身に加算
 *
 * 最終補正(%) = (100 - 合計加算値) * multiplyCorrection / 100 * DR補正 / 100
 * ダメージ    = floor(技ダメージ * 最終補正 / 100)
 * SAのみ最低保証 (minGuarantee) 適用
 */
function calculateCombo(entries, moveMap) {
  const results = [];
  let totalAdditive          = 0;
  let drApplied              = false; // DR補正（×85%）が有効か
  let afterCancelDR          = false; // キャンセルDR後（Dゲージ回収不可）
  let pendingComboCorrection = 0;     // 次の段に加算する追加コンボ補正
  let moveNumber             = 0;     // 何段目か（1始まり）
  let previousMove           = null;  // 直前の技（instant補正判定用）
  let normalStartupApplied   = false; // 通常始動補正は一度のみ

  // 1段目の技で特殊始動補正があるか確認
  const firstMoveEntry = entries.find(e => e.type === 'move');
  const firstMove      = firstMoveEntry ? moveMap[firstMoveEntry.moveId] : null;
  const hasSpecialStartup = !!(firstMove && firstMove.startupCorrection > 0);

  let totalDamage          = 0;
  let totalSaGauge         = 0;
  let totalDriveRecovery   = 0;
  let totalDriveConsumption = 0;

  for (const entry of entries) {

    // ---- ラッシュ処理 ----
    if (entry.type === 'rush') {
      const isMidCombo = moveNumber > 0; // 技を1つ以上出した後のラッシュ = コンボ中ラッシュ
      if (isMidCombo) {
        drApplied = true;
        if (entry.rushType === 'cancel') {
          afterCancelDR = true;
          totalDriveConsumption += 30000;
        } else {
          totalDriveConsumption += 10000;
        }
      }
      results.push({ type: 'rush', rushType: entry.rushType, isMidCombo });
      continue;
    }

    // ---- 技処理 ----
    const move = moveMap[entry.moveId];
    if (!move) {
      results.push({ type: 'unknown', moveId: entry.moveId });
      continue;
    }

    moveNumber++;
    let addedThisMove = 0;

    // 追加コンボ補正（前の技から持ち越し）
    if (pendingComboCorrection > 0) {
      addedThisMove += pendingComboCorrection;
      pendingComboCorrection = 0;
    }

    // 3段目以降の処理
    if (moveNumber >= 3) {
      addedThisMove += 10; // 基本コンボ補正（毎段）

      // 通常始動補正（3段目に一度だけ）
      if (!hasSpecialStartup && !normalStartupApplied) {
        addedThisMove += 10;
        normalStartupApplied = true;
      }
    }

    // 特殊始動補正（2段目に一度だけ）
    if (moveNumber === 2 && hasSpecialStartup) {
      addedThisMove += firstMove.startupCorrection;
    }

    // 即時補正（2段目以降、条件を満たす場合のみその段に加算）
    if (moveNumber >= 2 && move.instantCorrection > 0) {
      let applyInstant = false;
      if (move.instantCorrectionCondition === 'always') {
        applyInstant = true;
      } else if (move.instantCorrectionCondition === 'cancel_from_special') {
        applyInstant = !!(previousMove && previousMove.category === 'special');
      }
      if (applyInstant) addedThisMove += move.instantCorrection;
    }

    // 合計加算値（90上限）
    totalAdditive = Math.min(totalAdditive + addedThisMove, 90);

    // 最終補正計算
    const drMult  = drApplied ? 85 : 100;
    const rawPct  = (100 - totalAdditive) * move.multiplyCorrection / 100 * drMult / 100;
    let finalPct  = rawPct;
    let minGuaranteeApplied = false;

    // SA最低保証
    if (move.category === 'sa' && move.minGuarantee && rawPct < move.minGuarantee) {
      finalPct = move.minGuarantee;
      minGuaranteeApplied = true;
    }

    const damage = Math.floor(move.damage * finalPct / 100);

    // Dゲージ回収（キャンセルDR後は0）
    const driveHit = afterCancelDR ? 0 : move.driveGaugeHit;
    totalDriveRecovery += driveHit;

    // OD技のDゲージ消費
    if (move.isOD) totalDriveConsumption += 20000;

    // SAゲージ
    totalSaGauge += move.saGauge;
    totalDamage  += damage;

    // 次の段への追加コンボ補正を設定
    if (move.comboCorrection > 0) {
      pendingComboCorrection = Math.max(0, move.comboCorrection - 10);
    }

    results.push({
      type: 'move',
      move, moveNumber, addedThisMove, totalAdditive,
      rawPct, finalPct, minGuaranteeApplied, damage,
      driveHit, drApplied, afterCancelDR,
    });

    previousMove = move;
  }

  return {
    entries: results,
    totalDamage, totalSaGauge,
    totalDriveRecovery, totalDriveConsumption,
    driveBalance: totalDriveRecovery - totalDriveConsumption,
  };
}

// ===== Results =====
function renderResults(calc) {
  const el = document.getElementById('results-content');

  if (!calc) {
    el.className = 'results-empty';
    el.innerHTML = '<p>コンボを入力すると結果が表示されます</p>';
    return;
  }

  // SAゲージ表示（10000 = 1ゲージ）
  const saDisplay = (calc.totalSaGauge / 10000).toFixed(2) + ' ゲージ';

  // Dゲージ収支表示（メモリ単位）
  const bal       = calc.driveBalance / 10000;
  const balSign   = bal >= 0 ? '+' : '';
  const balDisplay = `${balSign}${bal.toFixed(1)} メモリ`;
  const balClass  = bal >= 0 ? 'positive' : 'negative';

  // 内訳テーブル行
  const rows = [];
  for (const e of calc.entries) {
    if (e.type === 'rush') {
      const label = e.rushType === 'cancel'
        ? 'キャンセルDR（Dゲージ -3.0）'
        : (e.isMidCombo ? '生ラッシュ（コンボ中・Dゲージ -1.0）' : '生ラッシュ始動');
      const cls = e.rushType === 'cancel' ? 'row-cancel-dr' : 'row-rush';
      rows.push(`<tr class="${cls}"><td colspan="6">&#8212; ${label} &#8212;</td></tr>`);

    } else if (e.type === 'move') {
      const corrStr  = e.addedThisMove === 0 ? '–' : `+${e.addedThisMove}`;
      const drTag    = e.drApplied ? ' <span class="dr-on">[DR]</span>' : '';
      let   pctStr   = `${e.finalPct.toFixed(1)}%`;
      if (e.minGuaranteeApplied) pctStr += ' <small>(最低保証)</small>';

      rows.push(`<tr>
        <td>${e.moveNumber}</td>
        <td>${escapeHtml(e.move.name)}${drTag}</td>
        <td>${corrStr}</td>
        <td>${e.totalAdditive}</td>
        <td>${pctStr}</td>
        <td>${e.damage}</td>
      </tr>`);

    } else {
      rows.push(`<tr><td colspan="6" style="color:var(--text-muted);font-size:12px">不明な技: ${escapeHtml(e.moveId)}</td></tr>`);
    }
  }

  el.className = '';
  el.innerHTML = `
    <div class="summary">
      <div class="summary-item highlight">
        <div class="summary-label">総ダメージ</div>
        <div class="summary-value">${calc.totalDamage}</div>
      </div>
      <div class="summary-item">
        <div class="summary-label">SAゲージ増加</div>
        <div class="summary-value">${saDisplay}</div>
      </div>
      <div class="summary-item ${balClass}">
        <div class="summary-label">Dゲージ収支</div>
        <div class="summary-value">${balDisplay}</div>
      </div>
    </div>

    <div class="breakdown">
      <h3>ダメージ内訳</h3>
      <div class="table-scroll">
        <table class="breakdown-table">
          <thead>
            <tr>
              <th>段</th>
              <th>技名</th>
              <th>加算値</th>
              <th>累計補正</th>
              <th>最終補正</th>
              <th>ダメージ</th>
            </tr>
          </thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
      <p class="table-note">※ SA最低保証適用　[DR] ドライブラッシュ補正（×85%）適用中</p>
    </div>

    <div class="d-gauge-detail">
      <span>消費: ${(calc.totalDriveConsumption / 10000).toFixed(1)} メモリ</span>
      <span>回収: +${(calc.totalDriveRecovery / 10000).toFixed(1)} メモリ</span>
    </div>
  `;
}

// ===== Save/Load =====
function saveCombo(name) {
  if (!characterData) { alert('キャラクターデータが読み込まれていません'); return; }
  const saved = getSavedCombos();
  saved.push({
    id: Date.now().toString(),
    name,
    character: characterData.character,
    combo: JSON.parse(JSON.stringify(currentCombo)),
    createdAt: new Date().toISOString(),
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  renderSavedList();
}

function getSavedCombos() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
  catch { return []; }
}

function renderSavedList() {
  const saved = getSavedCombos();
  const el = document.getElementById('saved-list');

  if (saved.length === 0) {
    el.innerHTML = '<p class="no-saved">保存済みコンボはありません</p>';
    return;
  }

  el.innerHTML = saved.map(c => {
    const date = new Date(c.createdAt).toLocaleDateString('ja-JP');
    return `<div class="saved-item">
      <div class="saved-info">
        <span class="saved-name">${escapeHtml(c.name)}</span>
        <span class="saved-meta">${escapeHtml(c.character)} / ${date}</span>
      </div>
      <div class="saved-controls">
        <button class="btn-load" data-id="${c.id}">読み込み</button>
        <button class="btn-del"  data-id="${c.id}">削除</button>
      </div>
    </div>`;
  }).join('');

  el.querySelectorAll('.btn-load').forEach(btn => {
    btn.addEventListener('click', () => {
      const combo = getSavedCombos().find(c => c.id === btn.dataset.id);
      if (combo) {
        currentCombo = JSON.parse(JSON.stringify(combo.combo));
        renderCombo();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  });

  el.querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('このコンボを削除しますか？')) return;
      const filtered = getSavedCombos().filter(c => c.id !== btn.dataset.id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
      renderSavedList();
    });
  });
}

// ===== Utilities =====
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
