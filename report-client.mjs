// Fixed, offline-only report enhancement. Publisher accepts exactly these bytes.
export const REPORT_CLIENT_SCRIPT = `(() => {
  document.querySelectorAll('table[data-searchable]').forEach(table => {
    const label = document.createElement('label');
    label.className = 'report-search';
    label.textContent = 'Search player, team, school or FIDE ID ';
    const input = document.createElement('input'); input.type = 'search';
    input.setAttribute('aria-label', 'Search ' + (table.caption?.textContent || 'report'));
    label.append(input); table.before(label);
    input.addEventListener('input', () => {
      const query = input.value.trim().toLocaleLowerCase();
      Array.from(table.tBodies[0]?.rows || []).forEach(row => { row.hidden = !row.textContent.toLocaleLowerCase().includes(query); });
    });
    Array.from(table.tHead?.rows[0]?.cells || []).forEach((th, index) => {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = th.textContent;
      th.textContent = ''; th.append(button); let ascending = true;
      button.addEventListener('click', () => {
        const rows = Array.from(table.tBodies[0].rows);
        rows.sort((a,b) => {
          const x=a.cells[index].textContent.trim(), y=b.cells[index].textContent.trim();
          const result=x!=='' && y!=='' && Number.isFinite(Number(x)) && Number.isFinite(Number(y)) ? Number(x)-Number(y) : x.localeCompare(y, undefined, {numeric:true});
          return ascending ? result : -result;
        });
        table.querySelectorAll('th').forEach(cell => cell.removeAttribute('aria-sort'));
        th.setAttribute('aria-sort', ascending ? 'ascending' : 'descending'); ascending = !ascending;
        rows.forEach(row=>table.tBodies[0].append(row));
      });
    });
  });
})();`;
