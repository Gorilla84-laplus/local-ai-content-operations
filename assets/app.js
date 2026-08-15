document.querySelectorAll('a[href^="#"]').forEach((link) => link.addEventListener('click', () => document.body.classList.add('is-navigating')));
