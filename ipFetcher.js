(async () => {
    const fetch = (await import('node-fetch')).default;

    async function extractIpAddress() {
        const url = 'http://powerview-g3.local/gateway/swagger?enable=true';

        try {
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            const data = await response.json();

            const msg = data.msg;
            const ipRegex = /http:\/\/(\d+\.\d+\.\d+\.\d+)/;

            const match = msg.match(ipRegex);
            if (match) {
                const ipAddress = match[1];
                console.log('Extracted IP address:', ipAddress);
                return ipAddress;
            } else {
                console.log('No IP address found in the message.');
                return null;
            }
        } catch (error) {
            console.error('Failed to fetch or parse the JSON data:', error);
        }
    }

    extractIpAddress();
})();
