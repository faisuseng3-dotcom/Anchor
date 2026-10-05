export const VENUES = [
  // BARER
  { id: 'soap-bar', name: 'Soap Bar', address: 'Nybrogatan 1', area: 'Östermalm', type: 'bar', lat: 59.3349, lng: 18.0735, closing: '03:00' },
  { id: 'akkurat', name: 'Akkurat Bar & Restaurang', address: 'Hornsgatan 18', area: 'Slussen', type: 'bar', lat: 59.3190, lng: 18.0640, closing: '01:00' },
  { id: 'tjoget', name: 'Tjoget', address: 'Hornsbruksgatan 24', area: 'Hornstull', type: 'bar', lat: 59.3157, lng: 18.0348, closing: '01:00' },
  { id: 'sturehof', name: 'Sturehof', address: 'Stureplan 2', area: 'Östermalm', type: 'bar', lat: 59.3361, lng: 18.0733, closing: '02:00' },
  { id: 'pelikan', name: 'Pelikan', address: 'Blekingegatan 40', area: 'Södermalm', type: 'bar', lat: 59.3121, lng: 18.0760, closing: '01:00' },
  { id: 'morfar-ginko', name: 'Morfar Ginko', address: 'Swedenborgsgatan 13', area: 'Södermalm', type: 'bar', lat: 59.3150, lng: 18.0645, closing: '01:00' },
  { id: 'spy-bar', name: 'Spy Bar', address: 'Birger Jarlsgatan 20', area: 'Östermalm', type: 'bar', lat: 59.3360, lng: 18.0730, closing: '05:00' },
  { id: 'fasching', name: 'Fasching', address: 'Kungsgatan 63', area: 'Norrmalm', type: 'bar', lat: 59.3350, lng: 18.0620, closing: '03:00' },
  { id: 'berns', name: 'Berns', address: 'Berzelii Park', area: 'Norrmalm', type: 'bar', lat: 59.3322, lng: 18.0739, closing: '03:00' },
  { id: 'lounge-bar', name: 'The Lounge Bar', address: 'Sveavägen 45', area: 'Norrmalm', type: 'bar', lat: 59.3360, lng: 18.0620, closing: '01:00' },
  { id: 'niva22', name: 'Nivå 22', address: 'Fridhemsgatan 17', area: 'Kungsholmen', type: 'bar', lat: 59.3420, lng: 18.0490, closing: '01:00' },
  // NATTKLUBBAR
  { id: 'cafe-opera', name: 'Café Opera', address: 'Karl XII:s torg 6', area: 'Kungsträdgården', type: 'klubb', lat: 59.3307, lng: 18.0715, closing: '05:00' },
  { id: 'tradgarden', name: 'Trädgården', address: 'Hammarby Slussväg 2', area: 'Södermalm', type: 'klubb', lat: 59.3070, lng: 18.0800, closing: '05:00' },
  { id: 'under-bron', name: 'Under Bron', address: 'Skansbron 4', area: 'Södermalm', type: 'klubb', lat: 59.3070, lng: 18.0800, closing: '05:00' },
  { id: 'sturecompagniet', name: 'Sturecompagniet', address: 'Sturegatan 4', area: 'Östermalm', type: 'klubb', lat: 59.3365, lng: 18.0735, closing: '05:00' },
  { id: 'kristall', name: 'Kristall', address: 'Regeringsgatan 12', area: 'Norrmalm', type: 'klubb', lat: 59.3340, lng: 18.0620, closing: '03:00' },
  { id: 'golden-hits', name: 'Golden Hits', address: 'Kungsgatan 26', area: 'Norrmalm', type: 'klubb', lat: 59.3340, lng: 18.0630, closing: '03:00' },
  { id: 'neu', name: 'Neu', address: 'Östgötagatan 8', area: 'Södermalm', type: 'klubb', lat: 59.3115, lng: 18.0780, closing: '05:00' },
  { id: 'end-nightclub', name: 'END Nightclub', address: 'Jakobsgatan 10', area: 'Norrmalm', type: 'klubb', lat: 59.3320, lng: 18.0640, closing: '05:00' },
  { id: 'nalen', name: 'Nalen', address: 'Regeringsgatan 74', area: 'Norrmalm', type: 'klubb', lat: 59.3360, lng: 18.0640, closing: '03:00' },
  { id: 'mosebacke', name: 'Mosebacke Etablissement', address: 'Mosebacke Torg 3', area: 'Södermalm', type: 'klubb', lat: 59.3184, lng: 18.0743, closing: '03:00' },
  { id: 'patricia', name: 'Patricia', address: 'Stadsgårdskajen 152', area: 'Södermalm', type: 'klubb', lat: 59.3190, lng: 18.0650, closing: '05:00' },
];

export function computeStatus(venueId, reports) {
  const venueReports = reports.filter(r => r.venue_id === venueId);
  if (!venueReports.length) return 'unknown';
  const counts = { none: 0, short: 0, medium: 0, long: 0 };
  venueReports.forEach(r => { if (counts[r.queue_status] !== undefined) counts[r.queue_status]++; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

export function getStatusLabel(status) {
  return { none: 'Ingen kö', short: '15 min', medium: '25 min', long: '30+ min', unknown: '' }[status] || '';
}

export function getStatusColor(status) {
  return { none: '#00875A', short: '#D97706', medium: '#C05500', long: '#E8001C', unknown: '#9CA3AF' }[status] || '#9CA3AF';
}

export function getVenueById(id) {
  return VENUES.find(v => v.id === id);
}

export default VENUES;
