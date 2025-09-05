import pygame
import pymunk
import sys
import math

# Constants

WIDTH, HEIGHT = 800, 600
FPS = 60

# Gravity (modifiable per level)
GRAVITY = [0, 900]  # [x, y] in px/s^2


# Initialize Pygame and window
pygame.init()
screen = pygame.display.set_mode((WIDTH, HEIGHT))
pygame.display.set_caption("Tetrilaunch")
clock = pygame.time.Clock()


# Initialize Pymunk space
space = pymunk.Space()
space.gravity = tuple(GRAVITY)

# Add world boundaries (static lines)
def add_boundaries(space, width, height, thickness=10):
    static_lines = [
        pymunk.Segment(space.static_body, (0, thickness), (width, thickness), thickness),  # top
        pymunk.Segment(space.static_body, (0, height-thickness), (width, height-thickness), thickness),  # bottom
        pymunk.Segment(space.static_body, (thickness, 0), (thickness, height), thickness),  # left
        pymunk.Segment(space.static_body, (width-thickness, 0), (width-thickness, height), thickness),  # right
    ]
    for line in static_lines:
        line.elasticity = 0.2
        line.friction = 0.8
    space.add(*static_lines)


add_boundaries(space, WIDTH, HEIGHT)

# Compactor platform
class Compactor:
    def __init__(self, x, width, height, speed=6, margin=60):
        self.width = width
        self.height = height // 2  # Half the screen height
        self.x = x
        self.y = HEIGHT - self.height // 2  # Bottom half of the screen
        self.speed = speed
        self.margin = margin
        self.body = pymunk.Body(body_type=pymunk.Body.KINEMATIC)
        self.body.position = (self.x, self.y)
        self.shape = pymunk.Segment(self.body, (0, -self.height//2), (0, self.height//2), self.width)
        self.shape.elasticity = 0.2
        self.shape.friction = 0.8
        space.add(self.body, self.shape)

    def update(self):
        # Move only from middle to right margin, then reset
        if self.body.position.x < WIDTH - self.margin:
            self.body.velocity = (self.speed, 0)
        else:
            # Reset to center when reaching the right side
            self.body.position = (WIDTH // 2, self.y)
            self.body.velocity = (0, 0)

    def draw(self, surface):
        x = int(self.body.position.x)
        y = int(self.body.position.y)
        pygame.draw.rect(surface, (255, 80, 80), (x - self.width//2, y - self.height//2, self.width, self.height))

# Line clear logic
def check_and_clear_lines(pieces, compactor, size=40, tolerance=8):
    # Group pieces by y-position (row) within a threshold
    y_thresh = 20  # Increased threshold
    force_thresh = 5000  # Increased force threshold
    rows = {}
    for idx, (body, shape, sz) in enumerate(pieces):
        x, y = body.position
        row_y = round(y / size) * size
        if abs(y - row_y) < y_thresh:
            rows.setdefault(row_y, []).append((idx, body, x))
    
    # Reset highlight for all pieces first
    for idx, (body, shape, sz) in enumerate(pieces):
        body.highlight = False
    
    # Highlight rows that have 3 or more pieces (disabled for now)
    # for row_y, items in rows.items():
    #     if len(items) >= 3:  # Highlight lines with 3+ pieces
    #         for idx, body, _ in items:
    #             body.highlight = True
    
    # Mark rows that are full (spanning most of the width) for removal
    full_rows = {}
    # Calculate required pieces based on compactor position
    compactor_x = compactor.body.position.x
    available_width = WIDTH - compactor_x - 50  # From compactor to right wall
    min_pieces_for_line = max(2, int(available_width / size) - 1)  # At least 3, but decreases as compactor moves right
    
    for row_y, items in rows.items():
        #print(f"Row {row_y} has {len(items)} pieces, needs {min_pieces_for_line} to be full (available width: {available_width})")
        if len(items) >= min_pieces_for_line:  # Dynamic threshold based on compactor position
            full_rows[row_y] = items
    # Compactor trigger: when its right edge crosses a box-size threshold, check for full rows and sum horizontal forces
    lines_cleared = 0
    to_remove = set()
    compactor_right = compactor.body.position.x + compactor.width // 2
    if hasattr(check_and_clear_lines, 'last_box_idx'):
        last_box_idx = check_and_clear_lines.last_box_idx
    else:
        last_box_idx = -1
    box_idx = int((WIDTH - compactor_right) // size)
    if box_idx != last_box_idx:
        print(f"Compactor crossed box index: {box_idx}")
        check_and_clear_lines.last_box_idx = box_idx
        
        #print full rows for debugging
        print(f"Full rows detected: {list(full_rows.keys())}")
        for row_y, items in full_rows.items():
            # Instead of force, check if pieces are close to the compactor and moving slowly (being compressed)
            pieces_near_compactor = 0
            total_velocity = 0
            for _, body, x in items:
                if abs(x - compactor_x) < size * 2:  # Within 2 box widths of compactor
                    pieces_near_compactor += 1
                total_velocity += abs(body.velocity.x)
            
            print(f"Row {row_y}: {len(items)} pieces, {pieces_near_compactor} near compactor, avg velocity: {total_velocity/len(items):.1f}")
            
            # Clear line if pieces are near compactor and moving slowly (being compressed)
            if pieces_near_compactor >= 2 and total_velocity / len(items) < 50:
                for idx, body, _ in items:
                    to_remove.add(idx)
                lines_cleared += 1
    # Remove from pymunk and list
    for i in sorted(to_remove, reverse=True):
        body, shape, sz = pieces[i]
        space.remove(body, shape)
        del pieces[i]
    return lines_cleared
def predict_trajectory(start_pos, angle, power, gravity, steps=60, dt=1/60):
    """
    Predicts the trajectory points for a launched piece.
    start_pos: (x, y)
    angle: radians
    power: initial velocity magnitude
    gravity: (gx, gy)
    steps: number of points
    dt: time step
    Returns: list of (x, y) points
    """
    points = []
    vx = power * math.cos(angle)
    vy = -power * math.sin(angle)
    x, y = start_pos
    gx, gy = gravity
    for i in range(steps):
        t = i * dt
        px = x + vx * t + 0.5 * gx * t * t
        py = y + vy * t + 0.5 * gy * t * t
        points.append((int(px), int(py)))
        # Stop if out of screen
        if px > WIDTH or px < 0 or py > HEIGHT or py < 0:
            break
    return points


# Cannon class
class Cannon:
    def __init__(self, x, y, size=40):
        self.x = x
        self.y = y
        self.size = size
        self.angle = 0  # radians, 0 is horizontal
        self.angle_speed = math.radians(2)
        self.min_angle = math.radians(-60)  # Can shoot higher up
        self.max_angle = math.radians(60)   # Can shoot higher down
        self.base_power = 400  # minimum power
        self.max_power = 1000  # maximum power
        self.current_power = self.base_power
        self.power_step = 20  # Power increase/decrease per key press
        self.piece_rotation = 0  # Current piece rotation
        self.last_shot_time = 0  # Time of last shot
        self.cooldown_duration = 1000  # Cooldown in milliseconds (1 second)
        self.current_piece_type = "I"  # Always start with I piece
        self.piece_types = ["I", "O", "T", "L", "J", "S", "Z"]
        self.piece_index = 0  # Index of current piece

    def rotate_left(self):
        self.angle = max(self.min_angle, self.angle - self.angle_speed)

    def rotate_right(self):
        self.angle = min(self.max_angle, self.angle + self.angle_speed)

    def rotate_piece_left(self):
        self.piece_rotation += math.radians(15)  # Rotate by 15 degrees

    def rotate_piece_right(self):
        self.piece_rotation -= math.radians(15)  # Rotate by 15 degrees

    def increase_power(self):
        """Increase power with W key"""
        self.current_power = min(self.max_power, self.current_power + self.power_step)

    def decrease_power(self):
        """Decrease power with S key"""
        self.current_power = max(self.base_power, self.current_power - self.power_step)

    def can_shoot(self, current_time):
        """Check if enough time has passed since last shot"""
        return current_time - self.last_shot_time >= self.cooldown_duration

    def shoot(self, current_time):
        """Record the time of shooting"""
        self.last_shot_time = current_time

    def next_piece(self):
        """Cycle to the next piece type"""
        self.piece_index = (self.piece_index + 1) % len(self.piece_types)
        self.current_piece_type = self.piece_types[self.piece_index]
        self.piece_rotation = 0  # Reset rotation when switching pieces

    def update_power(self, current_time):
        # No longer needed since we use W/S keys
        pass

    def start_charging(self, current_time):
        # No longer needed
        pass

    def stop_charging(self):
        # No longer needed, just return current power
        return self.current_power

    def draw(self, surface, gravity):
        # Calculate cannon color based on power (yellow to red)
        power_ratio = (self.current_power - self.base_power) / (self.max_power - self.base_power)
        red = int(200 + 55 * power_ratio)
        green = int(200 - 100 * power_ratio)
        blue = 50
        cannon_color = (red, green, blue)
        
        # Draw the cannon as a square, rotated
        rect = pygame.Rect(0, 0, self.size, self.size)
        rect.center = (self.x, self.y)
        # Create a surface for the square
        cannon_surf = pygame.Surface((self.size, self.size), pygame.SRCALPHA)
        pygame.draw.rect(cannon_surf, cannon_color, (0, 0, self.size, self.size))
        # Rotate the surface
        rotated_surf = pygame.transform.rotate(cannon_surf, math.degrees(self.angle))
        rotated_rect = rotated_surf.get_rect(center=(self.x, self.y))
        surface.blit(rotated_surf, rotated_rect.topleft)

        # Calculate the launch point (center of right edge of the square)
        offset = self.size // 2
        launch_x = self.x + offset * math.cos(self.angle)
        launch_y = self.y - offset * math.sin(self.angle)

        # Draw trajectory prediction always
        traj_points = predict_trajectory((launch_x, launch_y), self.angle, self.current_power, gravity)
        if len(traj_points) > 1:
            pygame.draw.lines(surface, (100, 255, 100), False, traj_points, 2)

    def draw_piece_preview(self, surface):
        """Draw a preview of the current piece on the left side"""
        # Define piece shapes as relative positions
        shapes = {
            "I": [(0, 0), (1, 0), (2, 0), (3, 0)],  # Line
            "O": [(0, 0), (1, 0), (0, 1), (1, 1)],  # Square
            "T": [(1, 0), (0, 1), (1, 1), (2, 1)],  # T-shape
            "L": [(0, 0), (0, 1), (0, 2), (1, 2)],  # L-shape
            "J": [(1, 0), (1, 1), (1, 2), (0, 2)],  # J-shape
            "S": [(1, 0), (2, 0), (0, 1), (1, 1)],  # S-shape
            "Z": [(0, 0), (1, 0), (1, 1), (2, 1)]   # Z-shape
        }
        
        colors = {
            "I": (0, 255, 255, 255),   # Cyan
            "O": (255, 255, 0, 255),   # Yellow
            "T": (128, 0, 128, 255),   # Purple
            "L": (255, 165, 0, 255),   # Orange
            "J": (0, 0, 255, 255),     # Blue
            "S": (0, 255, 0, 255),     # Green
            "Z": (255, 0, 0, 255)      # Red
        }
        
        # Draw "Next:" label
        font = pygame.font.Font(None, 36)
        label_surf = font.render("Next:", True, (255, 255, 255))
        surface.blit(label_surf, (50, 60))
        
        if self.current_piece_type in shapes:
            piece_shape = shapes[self.current_piece_type]
            color = colors[self.current_piece_type]
            
            # Preview position (top-left area)
            preview_x = 50
            preview_y = 100
            cube_size = 20
            
            # Apply rotation
            cos_angle = math.cos(self.piece_rotation)
            sin_angle = math.sin(self.piece_rotation)
            
            for px, py in piece_shape:
                # Rotate the piece
                rotated_x = px * cos_angle - py * sin_angle
                rotated_y = px * sin_angle + py * cos_angle
                
                # Draw the cube with simple pattern
                x = preview_x + rotated_x * cube_size
                y = preview_y + rotated_y * cube_size
                
                # Base color
                pygame.draw.rect(surface, color, (x, y, cube_size, cube_size))
                
                # Simple pattern for preview
                r, g, b = color[:3]
                dark_color = (max(0, r-60), max(0, g-60), max(0, b-60))
                
                if self.current_piece_type == 'I':  # Horizontal lines
                    for i in range(0, cube_size, 4):
                        pygame.draw.line(surface, dark_color, (x, y+i), (x+cube_size, y+i), 1)
                elif self.current_piece_type == 'O':  # Concentric squares
                    pygame.draw.rect(surface, dark_color, (x+2, y+2, cube_size-4, cube_size-4), 1)
                    pygame.draw.rect(surface, dark_color, (x+4, y+4, cube_size-8, cube_size-8), 1)
                elif self.current_piece_type == 'T':  # Diagonal lines
                    for i in range(0, cube_size*2, 6):
                        start_x = max(x, x+i-cube_size)
                        start_y = max(y, y+cube_size-i)
                        end_x = min(x+cube_size, x+i)
                        end_y = min(y+cube_size, y+cube_size)
                        if start_x < end_x and start_y < end_y:
                            pygame.draw.line(surface, dark_color, (start_x, start_y), (end_x, end_y), 1)
                elif self.current_piece_type == 'L':  # Vertical lines
                    for i in range(0, cube_size, 4):
                        pygame.draw.line(surface, dark_color, (x+i, y), (x+i, y+cube_size), 1)
                elif self.current_piece_type == 'S':  # Dots
                    for i in range(2, cube_size-2, 6):
                        for j in range(2, cube_size-2, 6):
                            pygame.draw.circle(surface, dark_color, (x+i, y+j), 1)
                
                # Border
                pygame.draw.rect(surface, dark_color, (x, y, cube_size, cube_size), 2)

def create_square_piece(x, y, angle, velocity, size=40):
    mass = 1
    inertia = pymunk.moment_for_box(mass, (size, size))
    body = pymunk.Body(mass, inertia)
    body.position = x, y
    body.angle = angle
    body.velocity = velocity
    shape = pymunk.Poly.create_box(body, (size, size))
    shape.friction = 0.5
    shape.color = (100, 200, 255, 255)
    space.add(body, shape)
    return body, shape, size

def create_tetris_piece(x, y, angle, velocity, piece_type="I", size=40):
    """Create a tetris piece made of connected cubes with breakable joints"""
    # Define piece shapes as relative positions
    shapes = {
        "I": [(0, 0), (1, 0), (2, 0), (3, 0)],  # Line
        "O": [(0, 0), (1, 0), (0, 1), (1, 1)],  # Square
        "T": [(1, 0), (0, 1), (1, 1), (2, 1)],  # T-shape
        "L": [(0, 0), (0, 1), (0, 2), (1, 2)],  # L-shape
        "J": [(1, 0), (1, 1), (1, 2), (0, 2)],  # J-shape
        "S": [(1, 0), (2, 0), (0, 1), (1, 1)],  # S-shape
        "Z": [(0, 0), (1, 0), (1, 1), (2, 1)]   # Z-shape
    }
    
    # Define colors for each piece type
    colors = {
        "I": (0, 255, 255, 255),   # Cyan
        "O": (255, 255, 0, 255),   # Yellow
        "T": (128, 0, 128, 255),   # Purple
        "L": (255, 165, 0, 255),   # Orange
        "J": (0, 0, 255, 255),     # Blue
        "S": (0, 255, 0, 255),     # Green
        "Z": (255, 0, 0, 255)      # Red
    }
    
    positions = shapes.get(piece_type, shapes["I"])
    piece_color = colors.get(piece_type, colors["I"])
    bodies = []
    joints = []
    
    # Create individual cubes
    for i, (px, py) in enumerate(positions):
        mass = 1
        inertia = pymunk.moment_for_box(mass, (size, size))
        body = pymunk.Body(mass, inertia)
        
        # Position relative to the piece center
        offset_x = (px - 1.5) * size
        offset_y = (py - 1.5) * size
        
        # Rotate offset by the piece angle
        rotated_x = offset_x * math.cos(angle) - offset_y * math.sin(angle)
        rotated_y = offset_x * math.sin(angle) + offset_y * math.cos(angle)
        
        body.position = x + rotated_x, y + rotated_y
        body.angle = angle
        body.velocity = velocity
        
        shape = pymunk.Poly.create_box(body, (size, size))
        shape.friction = 0.5
        shape.color = piece_color
        body.shape_color = piece_color[:3]  # Store RGB color on body for drawing
        body.piece_type = piece_type  # Store piece type for pattern drawing
        
        space.add(body, shape)
        bodies.append((body, shape, size))
    
    # Create breakable joints between adjacent cubes
    for i, (px1, py1) in enumerate(positions):
        for j, (px2, py2) in enumerate(positions[i+1:], i+1):
            # Check if cubes are adjacent (distance of 1 in grid)
            if abs(px1 - px2) + abs(py1 - py2) == 1:
                body1, _, _ = bodies[i]
                body2, _, _ = bodies[j]
                
                # Create a pin joint between adjacent cubes
                joint = pymunk.PinJoint(body1, body2, (0, 0), (0, 0))
                joint.max_force = 3000  # Even stronger joints
                space.add(joint)
                joints.append(joint)
    
    return bodies, joints

def draw_square_piece(surface, body, size):
    # Get the four corners of the square
    points = [body.local_to_world(v) for v in [(-size/2, -size/2), (size/2, -size/2), (size/2, size/2), (-size/2, size/2)]]
    # Use the shape's color if it exists, otherwise default blue
    base_color = getattr(body, 'shape_color', (100, 200, 255))
    piece_type = getattr(body, 'piece_type', 'I')
    
    # Calculate position and dimensions
    x = int(min(point[0] for point in points))
    y = int(min(point[1] for point in points))
    w = int(max(point[0] for point in points) - x)
    h = int(max(point[1] for point in points) - y)
    
    # Generate 3 shades from the base color
    r, g, b = base_color[:3]
    dark_color = (max(0, r-60), max(0, g-60), max(0, b-60))
    light_color = (min(255, r+40), min(255, g+40), min(255, b+40))
    
    # Draw the base polygon
    pygame.draw.polygon(surface, base_color, [(int(point[0]), int(point[1])) for point in points])
    
    # Draw patterns based on piece type
    if piece_type == 'I':  # Horizontal lines
        for i in range(0, h, 6):
            pygame.draw.line(surface, dark_color, (x, y+i), (x+w, y+i), 2)
            if i+3 < h:
                pygame.draw.line(surface, light_color, (x, y+i+3), (x+w, y+i+3), 1)
    
    elif piece_type == 'O':  # Concentric squares
        for i in range(0, min(w, h)//2, 4):
            rect = pygame.Rect(x+i, y+i, w-2*i, h-2*i)
            color = dark_color if i % 8 == 0 else light_color
            pygame.draw.rect(surface, color, rect, 2)
    
    elif piece_type == 'T':  # Diagonal lines (top-left to bottom-right)
        for i in range(-h, w, 8):
            start_x = max(x, x+i)
            start_y = y + max(0, -i)
            end_x = min(x+w, x+i+h)
            end_y = min(y+h, y+h)
            pygame.draw.line(surface, dark_color, (start_x, start_y), (end_x, end_y), 2)
        for i in range(-h, w, 8):
            start_x = max(x, x+i+4)
            start_y = y + max(0, -i-4)
            end_x = min(x+w, x+i+h+4)
            end_y = min(y+h, y+h)
            pygame.draw.line(surface, light_color, (start_x, start_y), (end_x, end_y), 1)
    
    elif piece_type == 'L':  # Vertical lines
        for i in range(0, w, 6):
            pygame.draw.line(surface, dark_color, (x+i, y), (x+i, y+h), 2)
            if i+3 < w:
                pygame.draw.line(surface, light_color, (x+i+3, y), (x+i+3, y+h), 1)
    
    elif piece_type == 'J':  # Diagonal lines (top-right to bottom-left)
        for i in range(0, w+h, 8):
            start_x = min(x+w, x+i)
            start_y = y + max(0, i-w)
            end_x = max(x, x+i-h)
            end_y = min(y+h, y+i)
            pygame.draw.line(surface, dark_color, (start_x, start_y), (end_x, end_y), 2)
        for i in range(4, w+h, 8):
            start_x = min(x+w, x+i)
            start_y = y + max(0, i-w)
            end_x = max(x, x+i-h)
            end_y = min(y+h, y+i)
            pygame.draw.line(surface, light_color, (start_x, start_y), (end_x, end_y), 1)
    
    elif piece_type == 'S':  # Dotted pattern
        for i in range(2, w-2, 6):
            for j in range(2, h-2, 6):
                pygame.draw.circle(surface, dark_color, (x+i, y+j), 2)
                if i+3 < w-2 and j+3 < h-2:
                    pygame.draw.circle(surface, light_color, (x+i+3, y+j+3), 1)
    
    elif piece_type == 'Z':  # Cross-hatch pattern
        # Horizontal lines
        for i in range(0, h, 8):
            pygame.draw.line(surface, dark_color, (x, y+i), (x+w, y+i), 1)
        # Vertical lines
        for i in range(0, w, 8):
            pygame.draw.line(surface, light_color, (x+i, y), (x+i, y+h), 1)
    
    # Draw border
    pygame.draw.polygon(surface, dark_color, [(int(point[0]), int(point[1])) for point in points], 2)

def check_pieces_on_left_side(pieces, blinking_pieces, compactor, current_time):
    """Check for pieces that have landed on the left side of the compactor and mark them for blinking"""
    compactor_left = compactor.body.position.x - compactor.width // 2
    pieces_to_remove = []
    
    for i, (body, shape, size) in enumerate(pieces):
        # Check if piece is on the left side of the compactor and moving slowly (landed)
        if (body.position.x < compactor_left and 
            abs(body.velocity.x) < 50 and abs(body.velocity.y) < 50):
            # Add to blinking list and mark for removal from main pieces list
            blinking_pieces.append((body, shape, size, current_time))
            pieces_to_remove.append(i)
    
    # Remove pieces from main list (in reverse order to maintain indices)
    for i in reversed(pieces_to_remove):
        pieces.pop(i)

def update_blinking_pieces(blinking_pieces, space, current_time):
    """Update blinking pieces and remove them after blinking duration"""
    blink_duration = 2000  # 2 seconds of blinking
    pieces_to_remove = []
    
    for i, (body, shape, size, start_time) in enumerate(blinking_pieces):
        if current_time - start_time > blink_duration:
            # Remove from physics space and mark for removal
            space.remove(body, shape)
            pieces_to_remove.append(i)
    
    # Remove expired blinking pieces (in reverse order)
    for i in reversed(pieces_to_remove):
        blinking_pieces.pop(i)
    
    return len(pieces_to_remove)  # Return number of pieces that disappeared

def draw_blinking_piece(surface, body, size, start_time, current_time):
    """Draw a piece with blinking effect"""
    blink_interval = 200  # Blink every 200ms
    time_since_start = current_time - start_time
    
    # Only draw if we're in a "visible" blink phase
    if (time_since_start // blink_interval) % 2 == 0:
        # Temporarily set red color and draw using the pattern system
        original_color = getattr(body, 'shape_color', (100, 200, 255))
        body.shape_color = (255, 100, 100)  # Red tint for blinking
        draw_square_piece(surface, body, size)
        body.shape_color = original_color  # Restore original color

def main():
    global GRAVITY
    cannon = Cannon(80, HEIGHT // 2, size=40)
    pieces = []  # List of (body, shape, size)
    blinking_pieces = []  # List of pieces that are blinking before disappearing: (body, shape, size, start_time)
    compactor = Compactor(WIDTH // 2, 20, HEIGHT, speed=6, margin=60)
    score = 0
    font = pygame.font.SysFont(None, 32)
    small_font = pygame.font.Font(None, 24)
    running = True
    show_instructions = False  # Toggle for instruction visibility
    
    while running:
        current_time = pygame.time.get_ticks()
        
        for event in pygame.event.get():
            if event.type == pygame.QUIT:
                running = False
            if event.type == pygame.MOUSEBUTTONDOWN:
                if event.button == 1:  # Left click
                    mouse_x, mouse_y = event.pos
                    help_button_rect = pygame.Rect(WIDTH - 40, 10, 30, 30)
                    if help_button_rect.collidepoint(mouse_x, mouse_y):
                        show_instructions = not show_instructions
            # Example: Change gravity with keys (for demo)
            if event.type == pygame.KEYDOWN:
                if event.key == pygame.K_g:
                    # Toggle gravity direction (down/up)
                    if GRAVITY[1] > 0:
                        GRAVITY = [0, -900]
                    else:
                        GRAVITY = [0, 900]
                    space.gravity = tuple(GRAVITY)
                if event.key == pygame.K_h:
                    # Increase gravity strength
                    GRAVITY[1] = int(GRAVITY[1] * 1.2) if GRAVITY[1] != 0 else 0
                    space.gravity = tuple(GRAVITY)
                if event.key == pygame.K_j:
                    # Decrease gravity strength
                    GRAVITY[1] = int(GRAVITY[1] * 0.8) if GRAVITY[1] != 0 else 0
                    space.gravity = tuple(GRAVITY)
                if event.key == pygame.K_SPACE:
                    # Shoot a tetris piece only if we can shoot
                    if cannon.can_shoot(current_time):
                        piece_type = cannon.current_piece_type  # Use current piece instead of random
                        
                        power = cannon.stop_charging()
                        
                        offset = cannon.size // 2
                        launch_x = cannon.x + offset * math.cos(cannon.angle)
                        launch_y = cannon.y - offset * math.sin(cannon.angle)
                        vx = power * math.cos(cannon.angle)
                        vy = -power * math.sin(cannon.angle)
                        
                        # Use the cannon's piece rotation
                        tetris_bodies, joints = create_tetris_piece(launch_x, launch_y, cannon.piece_rotation, (vx, vy), piece_type)
                        
                        # Add the pieces and record shot time
                        for body, shape, size in tetris_bodies:
                            pieces.append((body, shape, size))
                        
                        cannon.shoot(current_time)  # Record shot time for cooldown
                        cannon.next_piece()  # Move to next piece type
                if event.key == pygame.K_q:
                    cannon.rotate_piece_left()
                if event.key == pygame.K_e:
                    cannon.rotate_piece_right()
                if event.key == pygame.K_SLASH and keys[pygame.K_LSHIFT]:  # Shift + / = ?
                    show_instructions = not show_instructions

        # Continuous key handling for cannon rotation and power
        keys = pygame.key.get_pressed()
        if keys[pygame.K_a]:
            cannon.rotate_right()
        if keys[pygame.K_d]:
            cannon.rotate_left()
        if keys[pygame.K_LEFT]:
            cannon.rotate_right()
        if keys[pygame.K_RIGHT]:
            cannon.rotate_left()
        if keys[pygame.K_w]:
            cannon.increase_power()
        if keys[pygame.K_s]:
            cannon.decrease_power()
        if keys[pygame.K_UP]:
            cannon.increase_power()
        if keys[pygame.K_DOWN]:
            cannon.decrease_power()

        # Update compactor
        compactor.update()

        # Check and clear lines only when compactor overlaps them
        lines = check_and_clear_lines(pieces, compactor)
        if lines > 0:
            score += lines * 100
        
        # Check for pieces on the left side of compactor
        check_pieces_on_left_side(pieces, blinking_pieces, compactor, current_time)
        
        # Update blinking pieces and remove expired ones
        disappeared_count = update_blinking_pieces(blinking_pieces, space, current_time)
        if disappeared_count > 0:
            # Negative points for pieces that disappear, but don't go below 0
            penalty = disappeared_count * 50
            score = max(0, score - penalty)

        screen.fill((30, 30, 30))
        cannon.draw(screen, tuple(GRAVITY))
        cannon.draw_piece_preview(screen)  # Draw the piece preview
        compactor.draw(screen)
        # Draw all pieces
        for body, shape, size in pieces:
            draw_square_piece(screen, body, size)
        
        # Draw blinking pieces
        for body, shape, size, start_time in blinking_pieces:
            draw_blinking_piece(screen, body, size, start_time, current_time)

        # Draw UI at the top
        # Score and Power on the left
        score_surf = font.render(f"Score: {score}", True, (255,255,255))
        screen.blit(score_surf, (10, 10))
        
        power_surf = font.render(f"Power: {int(cannon.current_power)}", True, (255,255,255))
        screen.blit(power_surf, (150, 10))
        
        # Cooldown indicator
        can_shoot_now = cannon.can_shoot(current_time)
        if can_shoot_now:
            cooldown_surf = small_font.render("READY", True, (0, 255, 0))
        else:
            remaining_time = cannon.cooldown_duration - (current_time - cannon.last_shot_time)
            cooldown_surf = small_font.render(f"Cooldown: {remaining_time/1000:.1f}s", True, (255, 255, 0))
        screen.blit(cooldown_surf, (300, 10))
        
        # Next piece indicator
        next_surf = small_font.render("Next:", True, (255,255,255))
        screen.blit(next_surf, (450, 10))
        
        piece_type_surf = small_font.render(f"{cannon.current_piece_type}", True, (255,255,255))
        screen.blit(piece_type_surf, (490, 10))
        
        # Help button on the right
        help_button_rect = pygame.Rect(WIDTH - 40, 10, 30, 30)
        button_color = (100, 100, 100) if not show_instructions else (150, 150, 150)
        pygame.draw.rect(screen, button_color, help_button_rect)
        pygame.draw.rect(screen, (255, 255, 255), help_button_rect, 2)
        help_text = small_font.render("?", True, (255, 255, 255))
        text_rect = help_text.get_rect(center=help_button_rect.center)
        screen.blit(help_text, text_rect)
        
        # Draw instructions if toggled on
        if show_instructions:
            instructions_bg = pygame.Rect(WIDTH - 300, 50, 290, 120)
            pygame.draw.rect(screen, (50, 50, 50, 200), instructions_bg)
            pygame.draw.rect(screen, (255, 255, 255), instructions_bg, 2)
            
            controls = [
                "A/D or ←/→: Aim cannon",
                "W/S or ↑/↓: Increase/Decrease power",
                "Space: Shoot",
                "Q/E: Rotate piece",
                "?: Toggle help"
            ]
            for i, control in enumerate(controls):
                control_surf = small_font.render(control, True, (255, 255, 255))
                screen.blit(control_surf, (WIDTH - 290, 60 + i * 20))

        pygame.display.flip()
        clock.tick(FPS)
        space.step(1/FPS)

    pygame.quit()
    sys.exit()

if __name__ == "__main__":
    main()
