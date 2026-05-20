document.querySelectorAll('.filter-pills').forEach(group => {
  group.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      group.querySelectorAll('.filter-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const label = pill.closest('.filter-group').querySelector('.filter-label').textContent.replace(':', '').trim();
      console.log('Filter:', label, '→', pill.textContent.trim());
    });
  });
});

document.querySelectorAll('.filter-select').forEach(select => {
  select.addEventListener('change', () => {
    console.log('Sort by:', select.value);
  });
});
