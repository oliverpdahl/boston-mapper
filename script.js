// Initialize the map centered on Boston area
const map = L.map('map').setView([42.3601, -71.0589], 12);

// Define constants
const HALF_MILE_IN_METERS = 804.67; // 0.5 miles in meters

// Store location data by category for intersection calculation
const locationsByCategory = {
    'Catholic Church': [],
    'Trader Joe\'s': [],
    'Coworking Space': []
};

// Add OpenStreetMap tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

// Function to create a custom emoji icon
function createEmojiIcon(emoji, color, size = 32) {
    return L.divIcon({
        html: `<div style="font-size: ${size}px; color: ${color};">${emoji}</div>`,
        className: 'emoji-icon',
        iconSize: [size, size],
        iconAnchor: [size/2, size/2],
        popupAnchor: [0, -size/2]
    });
}

// Define custom icons and colors for each category
const categoryStyles = {
    'Catholic Church': {
        icon: createEmojiIcon('⛪', '#ff0000'),
        color: '#ff0000',  // Red
        fillColor: '#ff0000'
    },
    'Trader Joe\'s': {
        icon: createEmojiIcon('🛒', '#008000'),
        color: '#008000',  // Green
        fillColor: '#008000'
    },
    'Coworking Space': {
        icon: createEmojiIcon('💼', '#0000ff'),
        color: '#0000ff',  // Blue
        fillColor: '#0000ff'
    }
};

// Special icon for the Cathedral of the Holy Cross
const cathedralIcon = createEmojiIcon('👑', '#ff0000', 48);

// Create layer groups for each category
const layers = {
    'Catholic Church': L.layerGroup().addTo(map),
    'Trader Joe\'s': L.layerGroup().addTo(map),
    'Coworking Space': L.layerGroup().addTo(map),
    'Intersection': L.layerGroup().addTo(map) // Layer for areas where all three types overlap
};

// Fetch and parse CSV data
fetch('all_geocoded_locations.csv')
    .then(response => response.text())
    .then(csvData => {
        // Parse CSV data
        const rows = csvData.split('\n');
        const headers = rows[0].split(',');
        
        // Process each location
        for (let i = 1; i < rows.length; i++) {
            if (!rows[i].trim()) continue; // Skip empty rows
            
            // Handle quoted fields with commas inside them
            const row = parseCSVRow(rows[i]);
            
            const category = row[0];
            const lat = parseFloat(row[2]);
            const lng = parseFloat(row[3]);
            const name = row[4];
            const neighborhood = row[5];
            const address = row[1];
            
            // Skip entries with invalid coordinates
            if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0 || row[2] === 'ERROR') {
                console.log(`Skipping ${name} due to invalid coordinates`);
                continue;
            }
            
            // Create marker and circle with appropriate style
            if (categoryStyles[category]) {
                // Check if this is the Cathedral of the Holy Cross
                const isCathedral = category === 'Catholic Church' && name.includes('Cathedral of the Holy Cross');
                
                // Create marker with appropriate icon
                const marker = L.marker([lat, lng], { 
                    icon: isCathedral ? cathedralIcon : categoryStyles[category].icon 
                }).bindPopup(`
                    <strong>${name}</strong><br>
                    ${address}<br>
                    Neighborhood: ${neighborhood}
                `);
                
                // Create 0.5 mile radius circle with no fill, just border (lighter rings)
                const circle = L.circle([lat, lng], {
                    radius: HALF_MILE_IN_METERS,
                    color: categoryStyles[category].color,
                    fillColor: categoryStyles[category].fillColor,
                    fillOpacity: 0,          // No fill for individual circles
                    weight: 1.5,             // Thinner border
                    opacity: 0.7             // Lighter, more transparent border
                });
                
                // Add marker and circle to the appropriate layer
                if (layers[category]) {
                    layers[category].addLayer(marker);
                    layers[category].addLayer(circle);
                }
                
                // Store location data for intersection calculation
                locationsByCategory[category].push({
                    lat: lat,
                    lng: lng,
                    radius: HALF_MILE_IN_METERS
                });
            }
        }
    })
    .catch(error => console.error('Error loading or parsing CSV:', error))
    .finally(() => {
        // After all locations are processed, calculate and display intersections
        setTimeout(findAndDisplayIntersections, 1000);
    });

// Function to find and highlight areas where all three categories overlap
function findAndDisplayIntersections() {
    console.log('Finding intersections between all three categories...');
    
    // Skip if any category has no locations
    if (locationsByCategory['Catholic Church'].length === 0 ||
        locationsByCategory['Trader Joe\'s'].length === 0 ||
        locationsByCategory['Coworking Space'].length === 0) {
        console.log('Not all categories have locations. Skipping intersection calculation.');
        return;
    }
    
    // Clear previous intersection layers
    layers['Intersection'].clearLayers();
    
    // Generate all possible combinations of locations from the three categories
    const churches = locationsByCategory['Catholic Church'];
    const tradersJoes = locationsByCategory['Trader Joe\'s'];
    const coworkingSpaces = locationsByCategory['Coworking Space'];
    
    console.log(`Checking intersections among ${churches.length} churches, ${tradersJoes.length} Trader Joe's, and ${coworkingSpaces.length} coworking spaces...`);
    
    // Look for potential three-way intersections
    for (const church of churches) {
        for (const tj of tradersJoes) {
            // Skip if these two circles don't intersect
            const churchTjDistance = getDistance([church.lat, church.lng], [tj.lat, tj.lng]);
            if (churchTjDistance > church.radius + tj.radius) {
                continue; // No intersection possible
            }
            
            for (const coworking of coworkingSpaces) {
                // Skip if the third circle doesn't potentially intersect the other two
                const churchCoworkingDistance = getDistance([church.lat, church.lng], [coworking.lat, coworking.lng]);
                const tjCoworkingDistance = getDistance([tj.lat, tj.lng], [coworking.lat, coworking.lng]);
                
                if (churchCoworkingDistance > church.radius + coworking.radius || 
                    tjCoworkingDistance > tj.radius + coworking.radius) {
                    continue; // No three-way intersection possible
                }
                
                // If we get here, there's a potential three-way intersection
                // We'll use a dense point grid to approximate the intersection area
                createIntersectionPolygon(church, tj, coworking);
            }
        }
    }
    
    console.log('Overlap areas created');
}

// Function to create a polygon representing the intersection of three circles
function createIntersectionPolygon(circle1, circle2, circle3) {
    // Create a bounding box that contains all three circles
    const minLat = Math.min(circle1.lat, circle2.lat, circle3.lat) - HALF_MILE_IN_METERS / 111320; // approx meters to degrees conversion
    const maxLat = Math.max(circle1.lat, circle2.lat, circle3.lat) + HALF_MILE_IN_METERS / 111320;
    const minLng = Math.min(circle1.lng, circle2.lng, circle3.lng) - HALF_MILE_IN_METERS / (111320 * Math.cos(minLat * Math.PI / 180));
    const maxLng = Math.max(circle1.lng, circle2.lng, circle3.lng) + HALF_MILE_IN_METERS / (111320 * Math.cos(maxLat * Math.PI / 180));
    
    // Create a dense grid of points and check which ones are in all three circles
    const gridSize = 100; // Higher = more precise but slower
    const latStep = (maxLat - minLat) / gridSize;
    const lngStep = (maxLng - minLng) / gridSize;
    
    // Collect points that are in all three circles
    const intersectionPoints = [];
    
    for (let latIndex = 0; latIndex <= gridSize; latIndex++) {
        const lat = minLat + latIndex * latStep;
        
        for (let lngIndex = 0; lngIndex <= gridSize; lngIndex++) {
            const lng = minLng + lngIndex * lngStep;
            const point = [lat, lng];
            
            // Check if this point is within all three circles
            if (isPointWithinRadius(point, [circle1.lat, circle1.lng], circle1.radius) &&
                isPointWithinRadius(point, [circle2.lat, circle2.lng], circle2.radius) &&
                isPointWithinRadius(point, [circle3.lat, circle3.lng], circle3.radius)) {
                intersectionPoints.push(point);
            }
        }
    }
    
    // If we have enough points to form a polygon, create one
    if (intersectionPoints.length > 5) {
        // Find the boundary points to create a polygon
        const hullPoints = computeConvexHull(intersectionPoints);
        
        // Create a polygon from the hull points
        if (hullPoints.length >= 3) {
            const polygon = L.polygon(hullPoints, {
                color: '#800080',      // Purple border
                fillColor: '#800080',  // Purple fill
                fillOpacity: 0.7,      // Opacity
                weight: 1,             // Border weight
                smoothFactor: 1
            }).bindPopup('Area with access to all three amenities: Catholic Church, Trader Joe\'s, and Coworking Space');
            
            layers['Intersection'].addLayer(polygon);
        }
    }
}

// Function to calculate the distance between two points in meters
function getDistance(point1, point2) {
    const lat1 = point1[0];
    const lng1 = point1[1];
    const lat2 = point2[0];
    const lng2 = point2[1];
    
    return L.latLng(lat1, lng1).distanceTo(L.latLng(lat2, lng2));
}

// Function to compute the convex hull of a set of points (Graham scan algorithm)
function computeConvexHull(points) {
    if (points.length <= 3) return points;
    
    // Find the point with the lowest y-coordinate (and leftmost if tied)
    let lowestPoint = points[0];
    for (let i = 1; i < points.length; i++) {
        if (points[i][0] < lowestPoint[0] || 
            (points[i][0] === lowestPoint[0] && points[i][1] < lowestPoint[1])) {
            lowestPoint = points[i];
        }
    }
    
    // Sort points by polar angle with respect to the lowest point
    const sortedPoints = points.slice();
    const lowestPointRef = lowestPoint;
    
    sortedPoints.sort((a, b) => {
        if (a === lowestPointRef) return -1;
        if (b === lowestPointRef) return 1;
        
        const angleA = Math.atan2(a[0] - lowestPointRef[0], a[1] - lowestPointRef[1]);
        const angleB = Math.atan2(b[0] - lowestPointRef[0], b[1] - lowestPointRef[1]);
        
        if (angleA < angleB) return -1;
        if (angleA > angleB) return 1;
        
        // If angles are the same, sort by distance (closer first)
        const distA = Math.pow(a[0] - lowestPointRef[0], 2) + Math.pow(a[1] - lowestPointRef[1], 2);
        const distB = Math.pow(b[0] - lowestPointRef[0], 2) + Math.pow(b[1] - lowestPointRef[1], 2);
        return distA - distB;
    });
    
    // Build the hull
    const hull = [sortedPoints[0], sortedPoints[1]];
    
    for (let i = 2; i < sortedPoints.length; i++) {
        while (hull.length >= 2 && !isLeftTurn(hull[hull.length - 2], hull[hull.length - 1], sortedPoints[i])) {
            hull.pop();
        }
        hull.push(sortedPoints[i]);
    }
    
    return hull;
}

// Helper function to determine if three points make a left turn
function isLeftTurn(p1, p2, p3) {
    return ((p2[1] - p1[1]) * (p3[0] - p2[0]) - (p2[0] - p1[0]) * (p3[1] - p2[1])) > 0;
}

// Helper function to check if a point is within a radius of another point
function isPointWithinRadius(point, center, radius) {
    const latLng1 = L.latLng(point[0], point[1]);
    const latLng2 = L.latLng(center[0], center[1]);
    return latLng1.distanceTo(latLng2) <= radius;
}

// Function to parse CSV rows properly (handling quoted fields)
function parseCSVRow(text) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        
        if (char === '"') {
            inQuotes = !inQuotes;
            continue;
        }
        
        if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
            continue;
        }
        
        current += char;
    }
    
    result.push(current); // Add the last field
    return result;
}

// Add a legend
const legend = L.control({ position: 'bottomright' });

legend.onAdd = function(map) {
    const div = L.DomUtil.create('div', 'legend');
    div.innerHTML = '<h4>Location Types</h4>';
    
    // Add Cathedral as a special entry
    div.innerHTML += `
        <div class="legend-item">
            <span style="font-size: 20px;">👑</span>
            <span>Cathedral of the Holy Cross</span>
        </div>
    `;
    
    // Add regular categories with emoji icons
    const categories = ['Catholic Church', 'Trader Joe\'s', 'Coworking Space', 'All Three Overlap'];
    const colors = ['#ff0000', '#008000', '#0000ff', '#800080'];
    const emojis = ['⛪', '🛒', '💼', ''];
    
    for (let i = 0; i < categories.length; i++) {
        const label = i < 3 ? `${categories[i]} (0.5 mile radius)` : categories[i];
        
        if (i < 3) {
            // Categories with emoji icons
            div.innerHTML += `
                <div class="legend-item">
                    <span style="font-size: 16px; color: ${colors[i]}">${emojis[i]}</span>
                    <span>${label}</span>
                </div>
            `;
        } else {
            // Overlap areas (no emoji)
            div.innerHTML += `
                <div class="legend-item">
                    <i style="background-color: ${colors[i]}"></i>
                    <span>${label}</span>
                </div>
            `;
        }
    }
    
    return div;
};

legend.addTo(map);
