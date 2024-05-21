
// Hides "Important Information" when clicking blinds button
document.getElementById('btn-blinds').addEventListener('click', function() {
    document.getElementById('info').classList.add('hidden');
});
// Hides "Important Information" when clicking scenes button
document.getElementById('btn-scenes').addEventListener('click', function() {
    document.getElementById('info').classList.add('hidden');
});

// Add event listener for info button
document.getElementById('infoButton').addEventListener('click', function() {
    document.getElementById('info').classList.remove('hidden');
});
