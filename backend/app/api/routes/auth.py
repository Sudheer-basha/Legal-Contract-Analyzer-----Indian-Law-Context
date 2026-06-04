import hashlib
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.database import get_db
from app.db.models import User

router = APIRouter(prefix="/auth", tags=["User Authentication"])

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    name: str
    role: str  # advocate, lawyer, judge, common, admin

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class PresetLoginRequest(BaseModel):
    role: str

def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()

@router.post("/register")
async def register(req: RegisterRequest, db: AsyncSession = Depends(get_db)):
    # Validate role
    valid_roles = ["advocate", "lawyer", "judge", "common", "admin"]
    if req.role not in valid_roles:
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {', '.join(valid_roles)}")
        
    # Check if user exists
    stmt = select(User).where(User.email == req.email)
    res = await db.execute(stmt)
    existing_user = res.scalar_one_or_none()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already registered")
        
    # Create user
    new_user = User(
        email=req.email,
        password_hash=hash_password(req.password),
        name=req.name,
        role=req.role
    )
    db.add(new_user)
    await db.commit()
    await db.refresh(new_user)
    
    # Return user details and mock token (using email as simple token representation)
    return {
        "token": f"token-{new_user.email}",
        "user": {
            "id": new_user.id,
            "email": new_user.email,
            "name": new_user.name,
            "role": new_user.role
        }
    }

@router.post("/login")
async def login(req: LoginRequest, db: AsyncSession = Depends(get_db)):
    stmt = select(User).where(User.email == req.email)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    
    if not user or user.password_hash != hash_password(req.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
        
    return {
        "token": f"token-{user.email}",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role
        }
    }

@router.post("/preset-login")
async def preset_login(req: PresetLoginRequest, db: AsyncSession = Depends(get_db)):
    presets = {
        "advocate": {"email": "advocate@nyayasutra.in", "name": "Advocate Sudheer", "role": "advocate"},
        "lawyer": {"email": "lawyer@nyayasutra.in", "name": "Lawyer Ranjan", "role": "lawyer"},
        "judge": {"email": "judge@nyayasutra.in", "name": "Judge Gokhale", "role": "judge"},
        "common": {"email": "citizen@nyayasutra.in", "name": "Citizen Suresh", "role": "common"},
        "admin": {"email": "admin@nyayasutra.in", "name": "Admin Deepa", "role": "admin"}
    }
    
    if req.role not in presets:
        raise HTTPException(status_code=400, detail="Invalid preset role")
        
    preset = presets[req.role]
    
    # Check if this preset user exists in the DB, if not auto-create
    stmt = select(User).where(User.email == preset["email"])
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    
    if not user:
        user = User(
            email=preset["email"],
            password_hash=hash_password("PresetPassword123!"),
            name=preset["name"],
            role=preset["role"]
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        
    return {
        "token": f"token-{user.email}",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role
        }
    }

@router.get("/me")
async def get_me(authorization: str = Header(None), db: AsyncSession = Depends(get_db)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid authorization header")
        
    token = authorization.split(" ")[1]
    if not token.startswith("token-"):
        raise HTTPException(status_code=401, detail="Invalid session token")
        
    email = token.replace("token-", "")
    
    stmt = select(User).where(User.email == email)
    res = await db.execute(stmt)
    user = res.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=401, detail="User session not found")
        
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role
    }


@router.get("/users")
async def get_users(authorization: str = Header(None), db: AsyncSession = Depends(get_db)):
    """Fetches all users. Restrict access to Admin role."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Unauthorized")
        
    token = authorization.split(" ")[1]
    email = token.replace("token-", "")
    
    # Verify current user is admin
    admin_stmt = select(User).where(User.email == email)
    res_admin = await db.execute(admin_stmt)
    admin_user = res_admin.scalar_one_or_none()
    
    if not admin_user or admin_user.role != "admin":
        raise HTTPException(status_code=403, detail="Forbidden. Admin privilege required.")
        
    # Fetch all users
    stmt = select(User).order_by(User.created_at.desc())
    res = await db.execute(stmt)
    users = res.scalars().all()
    
    return [
        {
            "id": u.id,
            "email": u.email,
            "name": u.name,
            "role": u.role,
            "created_at": u.created_at
        }
        for u in users
    ]
