/**
 * Survey.gs - 설문 핵심 로직 (Google API 미사용 순수 함수)
 * md 문항 파일 해석·검증, 응답 검증, 집계, 결과보고서 문안 생성을 담당함.
 * 함수명 끝의 밑줄(_)은 Apps Script에서 외부(클라이언트) 호출이 차단되는 내부 함수 표기임.
 */

var TYPE_TAGS_ = { '단일': 'single', '복수': 'multi', '5점': 'scale5', '서술': 'text' };
var MAX_QUESTIONS_ = 40;
var MAX_TEXT_LEN_ = 1000;
var MAX_OTHER_LEN_ = 200;
var MULTI_SEP_ = ' | ';
var MIN_DASH_N_ = 5; // 대시보드에서 수치를 공개하는 최소 응답 수(소규모 집단 식별 방지)

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** 'YYYY-MM-DD' 또는 'YYYY-MM-DD HH:mm' → Date (한국시간 기준). 날짜만 있으면 23:59로 처리함. */
function parseDeadline_(s) {
  s = String(s == null ? '' : s).trim();
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  if (!m) return null;
  var hh = m[4] === undefined ? 23 : parseInt(m[4], 10);
  var mm = m[5] === undefined ? 59 : parseInt(m[5], 10);
  if (hh > 23 || mm > 59) return null;
  // 존재하지 않는 날짜(예: 2월 31일)는 Date가 다음 달로 넘겨 버리므로 직접 확인함
  var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), da = parseInt(m[3], 10);
  var chk = new Date(Date.UTC(y, mo - 1, da));
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== da) return null;
  // 표기한 마감 시각의 '분'이 끝날 때까지(:59.999) 접수함. 예: 23:59 마감 → 23:59:59까지 응답 가능
  var d = new Date(m[1] + '-' + m[2] + '-' + m[3] + 'T' + pad2_(hh) + ':' + pad2_(mm) + ':59.999+09:00');
  return isNaN(d.getTime()) ? null : d;
}

/** 마감일 문자열을 'YYYY-MM-DD HH:mm' 형태로 통일함. 해석 불가 시 null. */
function normalizeDeadline_(s) {
  var d = parseDeadline_(s);
  if (!d) return null;
  var m = String(s).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  var hh = m[4] === undefined ? 23 : parseInt(m[4], 10);
  var mm = m[5] === undefined ? 59 : parseInt(m[5], 10);
  return m[1] + '-' + m[2] + '-' + m[3] + ' ' + pad2_(hh) + ':' + pad2_(mm);
}

/**
 * md 문항 파일 해석.
 * @return {{ok:boolean, errors:string[], warnings:string[], spec:Object}}
 */
function parseSurveyMd_(md) {
  var errors = [], warnings = [];
  var text = String(md == null ? '' : md).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  var lines = text.split('\n');
  var meta = {};
  var i = 0;

  // 머리말(front matter)
  while (i < lines.length && lines[i].trim() === '') i++;
  if (i < lines.length && lines[i].trim() === '---') {
    i++;
    var closed = false;
    for (; i < lines.length; i++) {
      var ln = lines[i];
      if (ln.trim() === '---') { closed = true; i++; break; }
      var km = ln.match(/^\s*([A-Za-z_]+)\s*:\s*(.*)$/);
      if (km) meta[km[1].toLowerCase()] = km[2].trim();
      else if (ln.trim() !== '') warnings.push('머리말에서 인식되지 않은 줄: ' + ln.trim());
    }
    if (!closed) errors.push('머리말을 닫는 --- 줄이 없음');
  } else {
    errors.push('파일 첫머리에 --- 로 둘러싼 머리말(title, slug, deadline)이 필요함');
  }

  var spec = { title: meta.title || '', slug: meta.slug || '', deadline: '', target: 0, intro: '', category: '', program: '', year: '', questions: [] };

  if (!spec.title) errors.push('머리말에 title이 없음');
  else if (spec.title.length > 100) errors.push('title은 100자 이내여야 함');

  if (!spec.slug) errors.push('머리말에 slug가 없음 (영문 소문자·숫자·하이픈 2~40자, 예: healing2026)');
  else if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(spec.slug)) errors.push('slug는 영문 소문자·숫자·하이픈 2~40자여야 함: ' + spec.slug);

  if (!meta.deadline) errors.push('머리말에 deadline이 없음 (예: 2026-12-10 23:59)');
  else {
    var nd = normalizeDeadline_(meta.deadline);
    if (!nd) errors.push('deadline 형식 오류 (YYYY-MM-DD 또는 YYYY-MM-DD HH:mm): ' + meta.deadline);
    else spec.deadline = nd;
  }

  if (meta.target !== undefined && meta.target !== '') {
    var t = parseInt(meta.target, 10);
    if (!/^\d+$/.test(meta.target) || t < 1 || t > 100000) errors.push('target은 1 이상의 정수여야 함: ' + meta.target);
    else spec.target = t;
  }

  // 대시보드 분류 정보
  spec.category = String(meta.category || '기타').trim();
  spec.program = String(meta.program || spec.title).trim();
  spec.year = String(meta.year || '').trim();
  if (spec.category.length > 20) errors.push('category는 20자 이내여야 함');
  if (spec.program.length > 60) errors.push('program은 60자 이내여야 함');
  if (spec.year && !/^20\d{2}$/.test(spec.year)) errors.push('year는 4자리 연도여야 함 (예: 2026)');

  // 본문
  var cur = null, section = '', introLines = [], seenQuestion = false;
  for (; i < lines.length; i++) {
    var raw = lines[i], line = raw.trim(), no = i + 1;
    if (line === '') continue;

    if (/^##/.test(line)) {
      var qm = line.match(/^##\s*\[\s*(단일|복수|5점|서술)\s*(\*)?\s*(?::\s*(\d+))?\s*\]\s*(.+)$/);
      if (!qm) {
        errors.push(no + '행: 문항 형식 오류 → "## [단일*] 질문" 형태여야 함 (유형: 단일, 복수, 5점, 서술)');
        cur = null;
        continue;
      }
      cur = {
        id: 'Q' + (spec.questions.length + 1),
        type: TYPE_TAGS_[qm[1]],
        required: !!qm[2],
        max: qm[3] ? parseInt(qm[3], 10) : 0,
        text: qm[4].trim(),
        section: section,
        options: [], low: '', high: '', note: '', kpi: false
      };
      if (qm[3] && cur.type !== 'multi') warnings.push(no + '행: 선택 개수 제한(:숫자)은 [복수]에서만 적용됨');
      if (cur.text.length > 200) errors.push(no + '행: 질문은 200자 이내여야 함');
      spec.questions.push(cur);
      seenQuestion = true;
      continue;
    }
    if (/^#\s/.test(line)) { section = line.replace(/^#\s+/, '').trim(); cur = null; continue; }
    if (/^>/.test(line)) {
      if (!seenQuestion) introLines.push(line.replace(/^>\s?/, ''));
      else warnings.push(no + '행: 문항 뒤의 안내문(>)은 무시됨');
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!cur) { warnings.push(no + '행: 문항 밖의 보기는 무시됨'); continue; }
      if (cur.type !== 'single' && cur.type !== 'multi') { warnings.push(no + '행: ' + cur.id + '은(는) 보기가 필요 없는 유형이라 무시됨'); continue; }
      var label = line.replace(/^[-*]\s+/, '').trim();
      var other = /\(직접입력\)\s*$/.test(label);
      if (other) label = label.replace(/\(직접입력\)\s*$/, '').trim();
      if (!label) { errors.push(no + '행: 빈 보기'); continue; }
      cur.options.push({ label: label, other: other });
      continue;
    }
    var kv = line.match(/^(low|high|설명|지표)\s*:\s*(.+)$/i);
    if (kv && cur) {
      var k = kv[1].toLowerCase();
      if (k === 'low') cur.low = kv[2].trim();
      else if (k === 'high') cur.high = kv[2].trim();
      else if (k === '지표') {
        if (kv[2].trim() === '대표만족') cur.kpi = true;
        else warnings.push(no + '행: 알 수 없는 지표 값이라 무시됨(사용 가능: 대표만족) → ' + kv[2].trim());
      }
      else cur.note = kv[2].trim();
      continue;
    }
    warnings.push(no + '행: 인식되지 않은 줄이라 무시됨 → ' + line.slice(0, 40));
  }
  spec.intro = introLines.join('\n').trim();

  // 문항 검증
  if (spec.questions.length === 0) errors.push('문항이 1개도 없음');
  if (spec.questions.length > MAX_QUESTIONS_) errors.push('문항은 최대 ' + MAX_QUESTIONS_ + '개까지 가능함');
  spec.questions.forEach(function (q) {
    if (q.type === 'single' || q.type === 'multi') {
      if (q.options.length < 2) errors.push(q.id + ': 선택형 문항은 보기가 2개 이상 필요함 → ' + q.text);
      if (q.options.length > 20) errors.push(q.id + ': 보기는 20개 이내여야 함');
      var seen = {};
      q.options.forEach(function (o) {
        if (seen[o.label]) errors.push(q.id + ': 보기가 중복됨 → ' + o.label);
        seen[o.label] = true;
        if (o.label.indexOf('|') >= 0) errors.push(q.id + ': 보기에 | 문자를 쓸 수 없음 → ' + o.label);
        if (/^[=+\-@]/.test(o.label)) errors.push(q.id + ': 보기는 = + - @ 로 시작할 수 없음 → ' + o.label);
        if (o.label.length > 100) errors.push(q.id + ': 보기는 100자 이내여야 함');
      });
      if (q.type === 'multi' && q.max && q.max > q.options.length) warnings.push(q.id + ': 선택 개수 제한이 보기 수보다 큼');
    }
    if (q.type === 'scale5') {
      if (!q.low) q.low = '매우 낮음';
      if (!q.high) q.high = '매우 높음';
    }
  });

  var kpis = spec.questions.filter(function (q) { return q.kpi; });
  kpis.forEach(function (q) { if (q.type !== 'scale5') errors.push(q.id + ': 대표 지표는 [5점] 문항에만 지정할 수 있음'); });
  if (kpis.length > 1) errors.push('대표 지표(지표: 대표만족)는 설문당 1개만 지정할 수 있음');
  if (kpis.length === 0 && spec.questions.length) {
    warnings.push('대표 지표 문항이 없어 만족도 대시보드 비교에서 제외됨 (전반 만족도 [5점] 문항 아래에 "지표: 대표만족" 추가 권장)');
  }

  return { ok: errors.length === 0, errors: errors, warnings: warnings, spec: spec };
}

function safeCell_(v) {
  var s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function unsafeCell_(s) {
  s = String(s == null ? '' : s);
  return /^'[=+\-@]/.test(s) ? s.slice(1) : s;
}
function cleanText_(s, max) {
  return String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

/** 선택값 하나가 보기에 해당하는지 확인하고 정규화된 문자열을 반환함. 해당 없으면 null. */
function matchOption_(q, value) {
  value = String(value == null ? '' : value);
  for (var i = 0; i < q.options.length; i++) {
    var o = q.options[i];
    if (value === o.label) {
      if (o.other) return null; // 직접입력 보기는 내용 입력이 필수임
      return o.label;
    }
    if (o.other && value.indexOf(o.label + ': ') === 0) {
      var t = cleanText_(value.slice(o.label.length + 2).replace(/\|/g, '/'), MAX_OTHER_LEN_);
      if (!t) return null;
      return o.label + ': ' + t;
    }
  }
  return null;
}

/**
 * 응답 검증 및 시트 저장용 행(질문 순서) 생성.
 * @param {Object} answers {Q1: '보기'|['보기',...]|3|'서술'}
 * @return {{ok:boolean, error?:string, row?:string[]}}
 */
function buildRow_(spec, answers) {
  if (!answers || typeof answers !== 'object') return { ok: false, error: '응답 형식이 올바르지 않음' };
  var row = [];
  for (var i = 0; i < spec.questions.length; i++) {
    var q = spec.questions[i], a = answers[q.id], cell = '';
    var empty = a === undefined || a === null || a === '' || (Array.isArray(a) && a.length === 0);
    if (empty) {
      if (q.required) return { ok: false, error: q.id + '번 문항은 필수 응답임' };
      row.push('');
      continue;
    }
    if (q.type === 'single') {
      if (Array.isArray(a)) return { ok: false, error: q.id + ': 하나만 선택할 수 있음' };
      var m = matchOption_(q, a);
      if (m === null) return { ok: false, error: q.id + ': 올바르지 않은 선택값임' };
      cell = m;
    } else if (q.type === 'multi') {
      if (!Array.isArray(a)) return { ok: false, error: q.id + ': 복수 선택 형식이 올바르지 않음' };
      var vals = [], seen = {};
      for (var j = 0; j < a.length; j++) {
        var mv = matchOption_(q, a[j]);
        if (mv === null) return { ok: false, error: q.id + ': 올바르지 않은 선택값임' };
        if (!seen[mv]) { seen[mv] = true; vals.push(mv); }
      }
      if (q.max && vals.length > q.max) return { ok: false, error: q.id + ': 최대 ' + q.max + '개까지 선택할 수 있음' };
      cell = vals.join(MULTI_SEP_);
    } else if (q.type === 'scale5') {
      var n = Number(a);
      if (!(n >= 1 && n <= 5 && Math.floor(n) === n)) return { ok: false, error: q.id + ': 1~5 사이 값이어야 함' };
      cell = String(n);
    } else {
      cell = safeCell_(cleanText_(a, MAX_TEXT_LEN_));
      if (q.required && cell === '') return { ok: false, error: q.id + '번 문항은 필수 응답임' };
    }
    row.push(cell);
  }
  return { ok: true, row: row };
}

function pct_(a, b) { return b ? Math.round(a / b * 1000) / 10 : 0; }
function round1_(x) { return Math.round(x * 10) / 10; }

/**
 * 집계. rows는 질문 순서의 셀 배열 목록(문자열)임.
 */
function aggregate_(spec, rows) {
  var out = { n: rows.length, questions: [] };
  spec.questions.forEach(function (q, qi) {
    var cells = rows.map(function (r) { return r[qi] == null ? '' : String(r[qi]); })
      .filter(function (c) { return c !== ''; });
    var r = { id: q.id, text: q.text, type: q.type, section: q.section, answered: cells.length };
    if (q.type === 'single' || q.type === 'multi') {
      var counts = {}, otherTexts = [];
      q.options.forEach(function (o) { counts[o.label] = 0; });
      cells.forEach(function (c) {
        var parts = q.type === 'multi' ? c.split(MULTI_SEP_) : [c];
        parts.forEach(function (p) {
          for (var k = 0; k < q.options.length; k++) {
            var o = q.options[k];
            if (p === o.label) { counts[o.label]++; return; }
            if (o.other && p.indexOf(o.label + ': ') === 0) {
              counts[o.label]++;
              otherTexts.push(unsafeCell_(p.slice(o.label.length + 2)));
              return;
            }
          }
        });
      });
      r.options = q.options.map(function (o) {
        return { label: o.label, count: counts[o.label], pct: pct_(counts[o.label], cells.length) };
      });
      r.otherTexts = otherTexts;
    } else if (q.type === 'scale5') {
      var dist = [0, 0, 0, 0, 0], sum = 0;
      cells.forEach(function (c) { var v = Number(c); if (v >= 1 && v <= 5) { dist[v - 1]++; sum += v; } });
      var cnt = dist[0] + dist[1] + dist[2] + dist[3] + dist[4];
      r.dist = dist;
      r.valid = cnt;
      r.mean = cnt ? round1_(sum / cnt) : 0;
      r.pos = dist[3] + dist[4];
      r.posPct = pct_(r.pos, cnt);
      r.low = q.low; r.high = q.high;
    } else {
      r.texts = cells.map(unsafeCell_);
    }
    out.questions.push(r);
  });
  return out;
}

/** 결과보고서용 문안(공문서 명사형 종결). 줄 배열을 반환함. */
function buildReportLines_(spec, agg, target) {
  var L = [];
  var n = agg.n;
  target = target || spec.target || 0;
  L.push('1. 응답 현황');
  L.push('- 설문명: ' + spec.title);
  L.push('- 설문 기한: ' + spec.deadline + '까지');
  if (target) L.push('- 대상 ' + target + '명 중 ' + n + '명이 응답하여 응답률 ' + pct_(n, target) + '%임.');
  else L.push('- 총 ' + n + '명이 응답하였음.');
  if (n === 0) { L.push('- 접수된 응답이 없었음.'); return L; }

  var scales = agg.questions.filter(function (q) { return q.type === 'scale5'; });
  var choices = agg.questions.filter(function (q) { return q.type === 'single' || q.type === 'multi'; });
  var texts = agg.questions.filter(function (q) { return q.type === 'text'; });
  var sec = 2;

  if (scales.length) {
    L.push('');
    L.push(sec++ + '. 만족도 및 평가 문항(5점 척도)');
    scales.forEach(function (q) {
      if (!q.valid) { L.push('- ‘' + q.text + '’ 문항은 응답이 없었음.'); return; }
      L.push('- ‘' + q.text + '’ 문항은 평균 ' + q.mean + '점(5점 만점), 긍정 응답(4~5점) 비율 ' + q.posPct + '%(' + q.pos + '/' + q.valid + '명)로 나타났음.');
    });
  }
  if (choices.length) {
    L.push('');
    L.push(sec++ + '. 선택형 문항');
    choices.forEach(function (q) {
      var sorted = q.options.filter(function (o) { return o.count > 0; })
        .sort(function (a, b) { return b.count - a.count; }).slice(0, 3);
      if (!sorted.length) { L.push('- ‘' + q.text + '’ 문항은 응답이 없었음.'); return; }
      var parts = sorted.map(function (o) { return '‘' + o.label + '’ ' + o.count + '명(' + o.pct + '%)'; });
      var tail = sorted.length === 1 ? '이 선택하였음' : ' 순으로 나타났음';
      L.push('- ‘' + q.text + '’ 문항은 ' + parts.join(', ') + tail + (q.type === 'multi' ? '(복수응답).' : '.'));
    });
  }
  if (texts.length) {
    L.push('');
    L.push(sec++ + '. 서술형 의견');
    texts.forEach(function (q) {
      L.push('- ‘' + q.text + '’ 문항에 총 ' + q.texts.length + '건의 의견이 접수되었음.');
    });
  }
  return L;
}

/** 현재 시각 기준 설문 상태: 'open' | 'closed' */
function effectiveState_(status, deadlineStr, now) {
  if (status === 'closed') return 'closed';
  var d = parseDeadline_(deadlineStr);
  if (!d) return 'closed';
  return (now || new Date()).getTime() > d.getTime() ? 'closed' : 'open';
}


/**
 * 대시보드용 행 생성. items: [{slug,title,category,program,year,deadline,state,target,n,kpi:{valid,dist}|null}]
 * 대표 지표 응답이 minN건 미만이면 분포·평균을 담지 않음(서버에서 제거하므로 화면 쪽으로 새지 않음).
 */
function dashboardRows_(items, minN) {
  minN = minN || MIN_DASH_N_;
  return items.map(function (it) {
    var valid = it.kpi ? it.kpi.valid : 0;
    var shown = !!(it.kpi && valid >= minN);
    return {
      slug: it.slug, title: it.title, category: it.category, program: it.program, year: it.year,
      deadline: it.deadline, state: it.state, target: it.target || 0, n: it.n,
      hasKpi: !!it.kpi, valid: valid, shown: shown,
      dist: shown ? it.kpi.dist : null
    };
  }).sort(function (a, b) { return a.deadline < b.deadline ? 1 : a.deadline > b.deadline ? -1 : 0; });
}
