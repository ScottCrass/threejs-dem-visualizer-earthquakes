/**
 * Map Configuration (Optional/Fallback)
 * 
 * NOTE: As of the latest update, geographic bounds are automatically extracted 
 * from the GeoTIFF file metadata using tifImage.getBoundingBox().
 * 
 * This configuration file can be used as a fallback or for manual override
 * if needed, but is not required for normal operation.
 */

export const MAP_CONFIG = {
  // Center point of the map in decimal degrees
  center: {
    latitude: 61.2989,   // Mount Spurr, Alaska
    longitude: -152.2539
  },
  
  // Radius from center point in miles
  radiusMiles: 10,
  
  /**
   * Calculate approximate lat/lon bounds based on center and radius
   * Uses approximate conversions: 1 degree latitude ≈ 69 miles
   * Longitude conversion varies by latitude: ~54.6 miles at 61°N
   * 
   * @returns {Object} Calculated bounds with minLat, maxLat, minLon, maxLon
   */
  getBounds() {
    const latDegreePerMile = 1 / 69;
    // Longitude degrees per mile varies by latitude - more accurate calculation
    const latRadians = this.center.latitude * (Math.PI / 180);
    const lonDegreePerMile = 1 / (69 * Math.cos(latRadians));
    
    return {
      minLat: this.center.latitude - (this.radiusMiles * latDegreePerMile),
      maxLat: this.center.latitude + (this.radiusMiles * latDegreePerMile),
      minLon: this.center.longitude - (this.radiusMiles * lonDegreePerMile),
      maxLon: this.center.longitude + (this.radiusMiles * lonDegreePerMile)
    };
  }
};

/**
 * Alternative map configurations for easy switching
 * Uncomment and modify MAP_CONFIG assignment to use a different map
 */

// Example: Yellowstone National Park
export const YELLOWSTONE_CONFIG = {
  center: {
    latitude: 44.4280,
    longitude: -110.5885
  },
  radiusMiles: 15,
  getBounds() {
    const latDegreePerMile = 1 / 69;
    const latRadians = this.center.latitude * (Math.PI / 180);
    const lonDegreePerMile = 1 / (69 * Math.cos(latRadians));
    
    return {
      minLat: this.center.latitude - (this.radiusMiles * latDegreePerMile),
      maxLat: this.center.latitude + (this.radiusMiles * latDegreePerMile),
      minLon: this.center.longitude - (this.radiusMiles * lonDegreePerMile),
      maxLon: this.center.longitude + (this.radiusMiles * lonDegreePerMile)
    };
  }
};

// Example: Mount St. Helens
export const MOUNT_ST_HELENS_CONFIG = {
  center: {
    latitude: 46.1914,
    longitude: -122.1956
  },
  radiusMiles: 12,
  getBounds() {
    const latDegreePerMile = 1 / 69;
    const latRadians = this.center.latitude * (Math.PI / 180);
    const lonDegreePerMile = 1 / (69 * Math.cos(latRadians));
    
    return {
      minLat: this.center.latitude - (this.radiusMiles * latDegreePerMile),
      maxLat: this.center.latitude + (this.radiusMiles * latDegreePerMile),
      minLon: this.center.longitude - (this.radiusMiles * lonDegreePerMile),
      maxLon: this.center.longitude + (this.radiusMiles * lonDegreePerMile)
    };
  }
};

// To use a different configuration, change this line:
// export const ACTIVE_MAP_CONFIG = YELLOWSTONE_CONFIG;
// export const ACTIVE_MAP_CONFIG = MOUNT_ST_HELENS_CONFIG;
