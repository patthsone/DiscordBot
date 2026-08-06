export async function getServerInfo(ip, port, timeout = 5000) {
    try {
        const { GameDig } = await import('gamedig');
        const state = await GameDig.query({
            type: 'csgo',
            host: ip,
            port: port,
            socketTimeout: timeout,
            attemptTimeout: timeout + 2000,
            maxAttempts: 2,
        });
        return {
            name: state.name,
            map: state.map,
            players: state.players.length,
            max_players: state.maxplayers,
            game: 'Counter-Strike 2',
            player_list: state.players,
        };
    } catch (error) {
        console.error(`Ошибка получения информации с ${ip}:${port}:`, error.message);
        return null;
    }
}